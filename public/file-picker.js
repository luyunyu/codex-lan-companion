export function installFilePicker({ button, panel, input, fetchJson, getContext, t, onOpen }) {
  const document = button.ownerDocument;
  let contextKey = "";
  let context = {};
  let requestId = 0;
  let selection = [0, 0];
  let columns = [];
  let roots = [];
  let root = 0;
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    element.className = className;
    if (text != null) element.textContent = text;
    return element;
  };
  const control = (label, action, className = "") => {
    const element = node("button", className, label);
    element.type = "button";
    element.addEventListener("click", action);
    return element;
  };
  const close = () => {
    requestId++;
    panel.hidden = true;
    panel.replaceChildren();
    columns = [];
    roots = [];
    button.classList.remove("active");
    button.setAttribute("aria-expanded", "false");
  };
  const sync = (disabled = button.disabled) => {
    const next = getContext();
    const key = JSON.stringify(next);
    if (key !== contextKey || disabled) close();
    contextKey = key;
    context = next;
    button.disabled = disabled;
    button.title = t("filePickerTitle");
    button.setAttribute("aria-label", t("filePickerTitle"));
    button.querySelector(".plugin-picker-label").textContent = t("filePickerLabel");
  };
  const render = () => {
    const previousStrip = panel.querySelector(".file-columns");
    const horizontal = previousStrip?.scrollLeft || 0;
    const scrolls = [...panel.querySelectorAll(".file-column")].map((column) => column.scrollTop);
    panel.replaceChildren();
    const header = node("div", "file-picker-header");
    const title = node("strong", "", t("filePickerTitle"));
    const dismiss = control("×", () => { close(); button.focus(); }, "file-picker-close");
    dismiss.setAttribute("aria-label", t("fileClose"));
    header.append(title, dismiss);
    panel.append(header);
    if (roots.length > 1) {
      const select = node("select", "file-root-select");
      select.setAttribute("aria-label", t("fileRoot"));
      roots.forEach((path, index) => {
        const option = node("option", "", path);
        option.value = String(index);
        select.append(option);
      });
      select.value = String(root);
      select.addEventListener("change", () => { root = Number(select.value); void load("", 0); });
      panel.append(select);
    }
    const breadcrumbs = node("nav", "file-breadcrumbs");
    breadcrumbs.setAttribute("aria-label", t("fileCurrentDirectory"));
    columns.forEach((column, index) => {
      if (index) breadcrumbs.append(node("span", "", "›"));
      const label = index === 0 ? roots[root] || t("fileRoot") : column.directory.split("/").pop();
      const crumb = control(label, () => {
        requestId++;
        columns = columns.slice(0, index + 1);
        columns[index].selected = "";
        render();
      });
      if (index === columns.length - 1) crumb.setAttribute("aria-current", "location");
      breadcrumbs.append(crumb);
    });
    breadcrumbs.title = columns.at(-1)?.absolutePath || roots[root] || "";
    panel.append(breadcrumbs);
    const strip = node("div", "file-columns");
    columns.forEach((column, index) => {
      const list = node("div", "file-column");
      list.setAttribute("role", "group");
      list.setAttribute("aria-label", column.absolutePath || t("fileRoot"));
      if (column.loading) list.append(node("p", "file-picker-state", t("fileLoading")));
      else if (column.error) {
        list.append(node("p", "file-picker-state", t("fileFailed", { message: column.error })),
          control(t("fileRetry"), () => { void load(column.directory, index); }, "file-retry"));
      } else {
        if (!column.entries.length) list.append(node("p", "file-picker-state", t("fileEmpty")));
        column.entries.forEach((entry) => {
          const row = control("", () => {
            if (entry.directory) {
              column.selected = entry.path;
              void load(entry.path, index + 1);
            } else {
              if (JSON.stringify(getContext()) !== contextKey || input.disabled) { close(); return; }
              input.insertText(entry.absolutePath, ...selection);
              close();
            }
          }, "file-entry");
          row.title = entry.absolutePath;
          row.classList.toggle("selected", column.selected === entry.path);
          if (entry.directory) row.setAttribute("aria-expanded", String(column.selected === entry.path));
          const icon = node("span", "file-entry-icon", entry.directory ? "▸" : "·");
          icon.setAttribute("aria-hidden", "true");
          row.append(icon, node("span", "file-entry-name", entry.name));
          if (entry.directory) row.append(node("span", "file-entry-arrow", "›"));
          row.addEventListener("keydown", (event) => {
            if (event.key === "ArrowRight" && entry.directory) {
              event.preventDefault();
              column.selected = entry.path;
              void load(entry.path, index + 1, true);
            } else if (event.key === "ArrowLeft" && index > 0) {
              event.preventDefault();
              requestId++;
              columns = columns.slice(0, index);
              render();
              panel.querySelectorAll(".file-column")[index - 1]?.querySelector(".selected")?.focus();
            } else if (["ArrowDown", "ArrowUp"].includes(event.key)) {
              event.preventDefault();
              const next = event.key === "ArrowDown" ? row.nextElementSibling : row.previousElementSibling;
              if (next?.matches("button")) next.focus();
            }
          });
          list.append(row);
        });
        if (column.truncated) list.append(node("p", "file-picker-state", t("fileTruncated")));
      }
      strip.append(list);
    });
    panel.append(strip);
    strip.scrollLeft = horizontal;
    [...strip.children].forEach((column, index) => { column.scrollTop = scrolls[index] || 0; });
    breadcrumbs.scrollLeft = breadcrumbs.scrollWidth;
  };
  const load = async (directory, depth, focus = false) => {
    const id = ++requestId;
    const key = contextKey;
    const column = { directory, entries: [], loading: true, selected: "" };
    columns = [...columns.slice(0, depth), column];
    render();
    const reveal = () => {
      const strip = panel.querySelector(".file-columns");
      if (strip) strip.scrollLeft = strip.scrollWidth;
    };
    reveal();
    try {
      const params = new URLSearchParams({ root: String(root), directory });
      if (context.threadId) params.set("threadId", context.threadId);
      else if (context.projectId) params.set("projectId", context.projectId);
      if (context.homeVersion != null) params.set("homeVersion", String(context.homeVersion));
      const result = await fetchJson(`/api/project-files?${params}`);
      if (id !== requestId || key !== JSON.stringify(getContext()) || panel.hidden) return;
      roots = result.roots;
      root = result.root;
      Object.assign(column, result, { loading: false });
    } catch (error) {
      if (id !== requestId || key !== JSON.stringify(getContext()) || panel.hidden) return;
      Object.assign(column, { loading: false, error: error.message });
    }
    render();
    reveal();
    if (focus) panel.querySelectorAll(".file-column")[depth]?.querySelector("button")?.focus();
  };
  // Save the caret before the button takes focus (also covers touch and keyboard).
  button.addEventListener("pointerdown", () => { selection = [input.selectionStart, input.selectionEnd]; });
  button.addEventListener("click", () => {
    if (button.disabled) return;
    if (!panel.hidden) { close(); return; }
    sync();
    selection = [input.selectionStart, input.selectionEnd];
    onOpen();
    root = 0;
    panel.hidden = false;
    button.classList.add("active");
    button.setAttribute("aria-expanded", "true");
    void load("", 0, true);
  });
  document.addEventListener("click", (event) => {
    if (!panel.hidden && !event.composedPath().includes(panel) && !event.composedPath().includes(button)) close();
  });
  document.addEventListener("keydown", (event) => {
    if (!panel.hidden && event.key === "Escape") {
      event.preventDefault();
      close();
      input.focus();
      input.setSelectionRange(...selection);
    }
  });
  panel.hidden = true;
  return { sync, close };
}
