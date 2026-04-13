import { useEffect, useRef } from "react";
import { type AnnotateTool } from "./annotationTypes";

interface CanvasActions {
  fitImage: () => void;
  zoomIn:   () => void;
  zoomOut:  () => void;
}

export function useAnnotationKeys(
  setTool: (t: AnnotateTool) => void,
  navigate: (delta: number) => void,
  canvas: React.RefObject<CanvasActions | null>,
) {
  // Stable refs so the listener registered once on mount always calls
  // the latest versions of these callbacks without re-registering.
  const navigateRef = useRef(navigate);
  const setToolRef  = useRef(setTool);
  navigateRef.current = navigate;
  setToolRef.current  = setTool;

  // Register once on mount, unregister once on unmount.
  // Safe: Annotate only renders when activePage === "assets" && activeAsset,
  // so this listener is never active on any other tab.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowLeft")            navigateRef.current(-1);
      if (e.key === "ArrowRight")           navigateRef.current(1);
      if (e.key === "h" || e.key === "H")   setToolRef.current("hand");
      if (e.key === "b" || e.key === "B")   setToolRef.current("box");
      if (e.key === "p" || e.key === "P")   setToolRef.current("polygon");
      if (e.key === "f" || e.key === "F")   canvas.current?.fitImage();
      if (e.key === "+" || e.key === "=")   canvas.current?.zoomIn();
      if (e.key === "-")                    canvas.current?.zoomOut();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // empty deps = register on mount, unregister on unmount
}
