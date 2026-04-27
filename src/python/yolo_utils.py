"""
Shared utilities for Nab Python scripts.
"""

import os
import sys
import multiprocessing

def _gpu_check_worker(queue):
    """Worker function to be run in a separate process."""
    try:
        import torch
        if not torch.cuda.is_available():
            queue.put((False, "CUDA not available."))
            return
        
        # Actually try to touch the device to detect busy/wedged drivers.
        torch.empty(1, device="cuda")
        device_name = torch.cuda.get_device_name(0)
        queue.put((True, device_name))
    except Exception as e:
        queue.put((False, str(e)))

def is_gpu_available(verbose=True, timeout=10) -> bool:
    """
    Checks for GPU availability in a separate process with a timeout.
    This prevents the main process from hanging if the NVIDIA driver is wedged.
    """
    if verbose:
        print(f"[util] is_gpu_available: Checking GPU with {timeout}s timeout...", file=sys.stderr)

    # Use 'spawn' context to ensure a clean process state for the GPU check.
    ctx = multiprocessing.get_context('spawn')
    queue = ctx.Queue()
    p = ctx.Process(target=_gpu_check_worker, args=(queue,))
    
    try:
        p.start()
        p.join(timeout)
        
        if p.is_alive():
            if verbose:
                print(f"[util] is_gpu_available: Timeout reached ({timeout}s). GPU driver is likely hung. Forcing CPU.", file=sys.stderr)
            p.terminate()
            p.join()
            return False

        if not queue.empty():
            available, message = queue.get()
            if available:
                if verbose:
                    print(f"[util] is_gpu_available: CUDA available ({message})", file=sys.stderr)
                return True
            else:
                if verbose:
                    print(f"[util] is_gpu_available: CUDA not available or busy ({message})", file=sys.stderr)
                return False
    except Exception as e:
        if verbose:
            print(f"[util] is_gpu_available: Check failed: {e}", file=sys.stderr)
        return False
    finally:
        if p.is_alive():
            p.terminate()
            p.join()

    return False


def suppress_fd1():
    """
    Context manager that redirects both sys.stdout and the underlying OS file
    descriptor 1 to /dev/null. Needed because ultralytics C extensions write
    directly to fd 1, bypassing Python's sys.stdout.
    """
    class _Ctx:
        def __enter__(self):
            sys.stdout.flush()
            self._fd_save   = os.dup(1)
            devnull         = os.open(os.devnull, os.O_WRONLY)
            os.dup2(devnull, 1)
            os.close(devnull)
            self._old_stdout = sys.stdout
            sys.stdout       = open(os.devnull, "w")
            return self
        def __exit__(self, *_):
            sys.stdout.close()
            sys.stdout = self._old_stdout
            os.dup2(self._fd_save, 1)
            os.close(self._fd_save)
    return _Ctx()
