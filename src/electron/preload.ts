import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

// Channels the main process may push to the renderer.
const EVENT_CHANNELS = new Set(["training:status", "training:log", "engine:status"]);

contextBridge.exposeInMainWorld("electronAPI", {
  invoke: (channel: string, params?: unknown) => ipcRenderer.invoke(channel, params),
  /** Subscribe to a pushed event. Returns an unsubscribe function. */
  on: (channel: string, listener: (payload: unknown) => void) => {
    if (!EVENT_CHANNELS.has(channel)) throw new Error(`Unknown event channel: ${channel}`);
    const wrapped = (_event: IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => { ipcRenderer.removeListener(channel, wrapped); };
  },
});
