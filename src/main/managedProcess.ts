import { spawn, type ChildProcess } from "child_process";

const IS_WIN = process.platform === "win32";
const OUTPUT_DRAIN_MS = 2000;

/** How a managed process ended. `ok` is true only for a clean exit code 0. */
export type ExitInfo = {
	code: number | null;
	signal: NodeJS.Signals | null;
	spawnError: Error | null;
	ok: boolean;
};

export type ManagedProcess = {
	proc: ChildProcess;
	/** Resolves once the process has exited and all of its output was delivered. */
	exited: Promise<ExitInfo>;
	/**
	 * Ask the process to exit (SIGTERM to the main process only, so it can
	 * finish what it's doing), then force-kill its whole process tree after
	 * `graceMs`. Resolves when it has exited.
	 */
	stop: (graceMs?: number) => Promise<ExitInfo>;
};

export type ManagedOptions = {
	env?: NodeJS.ProcessEnv;
	cwd?: string;
	stdin?: string;
	onStdout?: (line: string) => void;
	onStderr?: (line: string) => void;
};

/**
 * Spawns a process in its own process group (POSIX) so the process and any
 * workers it starts (e.g. PyTorch data loaders) can be killed together.
 * Output is split into lines and delivered in order.
 */
export function startManaged(cmd: string[], opts: ManagedOptions = {}): ManagedProcess {
	const [executable, ...args] = cmd;
	const proc = spawn(executable, args, {
		stdio:    ["pipe", "pipe", "pipe"],
		env:      opts.env ?? process.env,
		cwd:      opts.cwd,
		detached: !IS_WIN,
	});

	const stdoutDone = readLines(proc.stdout, opts.onStdout);
	const stderrDone = readLines(proc.stderr, opts.onStderr);

	proc.stdin?.on("error", () => {}); // the process may exit before reading stdin
	if (opts.stdin != null) proc.stdin?.write(opts.stdin, "utf-8");
	proc.stdin?.end();

	const exited = new Promise<ExitInfo>(resolve => {
		let settled = false;
		proc.once("error", err => {
			if (settled) return;
			settled = true;
			// A process that never started has pipes that never end.
			resolve({ code: null, signal: null, spawnError: err, ok: false });
		});
		// "exit", not "close": workers the process started can hold its output
		// pipes open after it is gone, so "close" might never come. Kill them,
		// then give the output a moment to drain.
		proc.once("exit", (code, signal) => {
			if (settled) return;
			settled = true;
			killTree(proc, "SIGKILL");
			const drained = Promise.all([stdoutDone, stderrDone]);
			const timeout = new Promise(r => setTimeout(r, OUTPUT_DRAIN_MS));
			void Promise.race([drained, timeout]).then(() =>
				resolve({ code, signal, spawnError: null, ok: code === 0 }));
		});
	});

	let stopping: Promise<ExitInfo> | null = null;
	const stop = (graceMs = 5000): Promise<ExitInfo> => {
		if (stopping) return stopping;
		stopping = (async () => {
			if (proc.exitCode !== null || proc.signalCode !== null) {
				killTree(proc, "SIGKILL"); // clean up any workers left behind
				return exited;
			}
			try { proc.kill("SIGTERM"); } catch {}
			const timer = setTimeout(() => killTree(proc, "SIGKILL"), graceMs);
			const info = await exited;
			clearTimeout(timer);
			killTree(proc, "SIGKILL");
			return info;
		})();
		return stopping;
	};

	return { proc, exited, stop };
}

/**
 * Kills a process and everything it started. On POSIX this signals the
 * process group (processes spawned with `detached: true` lead their own
 * group); on Windows it uses `taskkill /T`. Safe to call on exited processes.
 */
export function killTree(proc: ChildProcess, signal: NodeJS.Signals = "SIGKILL"): void {
	if (!proc.pid) return;
	if (IS_WIN) {
		try {
			spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => {});
		} catch {}
		return;
	}
	try {
		process.kill(-proc.pid, signal);
	} catch {
		// Not a group leader (or already gone): fall back to the process itself.
		try { proc.kill(signal); } catch {}
	}
}

function readLines(stream: NodeJS.ReadableStream | null | undefined, onLine?: (line: string) => void): Promise<void> {
	return new Promise(resolve => {
		if (!stream) { resolve(); return; }
		let buf = "";
		stream.on("data", (chunk: Buffer | string) => {
			if (!onLine) return;
			buf += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
			const lines = buf.split(/\r\n|\n|\r/);
			buf = lines.pop() ?? "";
			for (const line of lines) if (line.trim()) onLine(line);
		});
		const finish = () => {
			if (onLine && buf.trim()) onLine(buf);
			buf = "";
			resolve();
		};
		stream.on("end", finish);
		stream.on("close", finish);
		stream.on("error", finish);
	});
}
