export type EmbedTheme = "light" | "dark";

/** Follow the host page's theme when readable; opaque frames follow the system. */
export function followHostTheme(apply: (theme: EmbedTheme) => void): () => void {
  try {
    const root = parent.document.documentElement;
    const observer = new MutationObserver(() => {
      apply(root.classList.contains("dark") ? "dark" : "light");
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    apply(root.classList.contains("dark") ? "dark" : "light");
    return () => observer.disconnect();
  } catch {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => apply(media.matches ? "dark" : "light");
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }
}
