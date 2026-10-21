const { Plugin, Modal, Notice, PluginSettingTab, Setting, setIcon } = require("obsidian");
const { ViewPlugin, Decoration, WidgetType, EditorView } = require("@codemirror/view");
const { RangeSetBuilder, StateEffect } = require("@codemirror/state");

const URL_RE = /^(https?:\/\/|mailto:|obsidian:\/\/|www\.)/i;
const DEFAULT_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DEFAULT_SETTINGS = {
  nanoidSize: 21,
  nanoidAlphabet: DEFAULT_ALPHABET,
  hideUrls: false,
  hideUrlsRevealOnCursor: true,
};
const [SIZE_MIN, SIZE_MAX] = [3, 36];

// Verifica si un valor tiene el formato de una URL.
const looksLikeUrl = (val) => URL_RE.test(String(val ?? "").trim());

// Elimina las barras invertidas de escape de una cadena de texto.
const unescapeMd = (val) => String(val).replace(/\\(.)/g, "$1");

// Comprueba si una cadena tiene paréntesis (abiertos o cerrados de más).
function unbalancedParens(val) {
  let depth = 0;
  for (const ch of val) {
    if (ch === "(") depth++;
    else if (ch === ")" && --depth < 0) return true;
  }
  return depth !== 0;
}

// Devuelve una cadena con los caracteres únicos, eliminando espacios.
const uniqueChars = (val) => [...new Set(String(val ?? "").replace(/\s/g, ""))].join("");

// Limita un número al rango permitido (entre SIZE_MIN y SIZE_MAX).
function clampSize(val) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? Math.min(SIZE_MAX, Math.max(SIZE_MIN, n)) : DEFAULT_SETTINGS.nanoidSize;
}

// Asegura que el alfabeto tenga al menos 2 caracteres únicos; si no, usa el predeterminado.
function normalizeAlphabet(val) {
  const alpha = uniqueChars(val);
  return alpha.length >= 2 ? alpha : DEFAULT_ALPHABET;
}

// Fusiona la configuración guardada con los valores predeterminados, validando cada campo.
function mergeSettings(saved) {
  const src = saved && typeof saved === "object" ? saved : {};
  return {
    nanoidSize: clampSize(src.nanoidSize),
    nanoidAlphabet: normalizeAlphabet(src.nanoidAlphabet ?? DEFAULT_ALPHABET),
    hideUrls: src.hideUrls === true,
    hideUrlsRevealOnCursor: src.hideUrlsRevealOnCursor !== false,
  };
}

// Genera un identificador aleatorio (nanoid) de longitud y alfabeto específicos.
function nanoid(size, alpha) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return Array.from(bytes, (b) => alpha[b % alpha.length]).join("");
}

// Formatea un enlace en sintaxis Markdown, escapando caracteres y manejando títulos opcionales.
function formatMdLink(text, url, title) {
  const safeText = String(text).replace(/[[\]]/g, "\\$&");
  const u = String(url).trim();
  const dest = /[\s<>]/.test(u) || unbalancedParens(u) ? `<${u.replace(/[<>]/g, "")}>` : u;
  return title ? `[${safeText}](${dest} "${title.replace(/"/g, '\\"')}")` : `[${safeText}](${dest})`;
}

// Encuentra el índice del corchete de cierre ']' correspondiente, omitiendo caracteres escapados.
function findMatchingRBracket(line, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < line.length; i++) {
    if (line[i] === "\\") { i++; continue; }
    if (line[i] === "[") depth++;
    else if (line[i] === "]" && --depth === 0) return i;
  }
  return -1;
}

// Analiza la sección de destino y título de un enlace Markdown: (<url> "title") o (url "title").
function parseLinkDestination(line, start) {
  let i = start;
  while (i < line.length && /[ \t]/.test(line[i])) i++;
  if (i >= line.length) return null;

  let url;
  let urlStart;
  let urlEnd;
  if (line[i] === "<") {
    const close = line.indexOf(">", i + 1);
    if (close < 0) return null;
    url = line.slice(i + 1, close);
    urlStart = i + 1;
    urlEnd = close;
    i = close + 1;
  } else {
    const from = i;
    let depth = 0;
    while (i < line.length) {
      const ch = line[i];
      if (ch === "\\") { i += 2; continue; }
      if (ch === "(") depth++;
      else if (ch === ")" && depth-- === 0) break;
      else if (/[ \t]/.test(ch)) break;
      i++;
    }
    url = line.slice(from, i);
    if (!url) return null;
    urlStart = from;
    urlEnd = i;
  }

  while (i < line.length && /[ \t]/.test(line[i])) i++;

  let title = "";
  if (['"', "'", "("].includes(line[i])) {
    const closer = line[i] === "(" ? ")" : line[i];
    const from = ++i;
    while (i < line.length && line[i] !== closer) {
      if (line[i] === "\\") i++;
      i++;
    }
    if (i >= line.length) return null;
    title = line.slice(from, i++);
    while (i < line.length && /[ \t]/.test(line[i])) i++;
  }

  return line[i] === ")" ? { url, title, end: i + 1, urlStart, urlEnd } : null;
}

// Busca un enlace Markdown en una posición específica de la línea y devuelve sus componentes.
function findMdLinkAt(line, ch) {
  let i = 0;
  while (i < line.length) {
    if (line[i] === "\\") { i += 2; continue; }
    const isImg = line[i] === "!" && line[i + 1] === "[";
    const open = isImg ? i + 1 : i;

    if (line[open] !== "[") { i++; continue; }

    const close = findMatchingRBracket(line, open);
    if (close < 0 || line[close + 1] !== "(") { i = open + 1; continue; }

    const dest = parseLinkDestination(line, close + 2);
    if (!dest) { i = open + 1; continue; }

    const from = isImg ? open - 1 : open;
    const to = dest.end;

    if (!isImg && ch >= from && ch <= to) {
      return {
        text: unescapeMd(line.slice(open + 1, close)),
        url: unescapeMd(dest.url),
        title: dest.title ? unescapeMd(dest.title) : "",
        from,
        to,
      };
    }
    i = to;
  }
  return null;
}

// Encuentra todos los enlaces o imágenes en una línea y las posiciones de sus URLs.
function findAllLinkUrls(line) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === "\\") { i += 2; continue; }
    const isImg = line[i] === "!" && line[i + 1] === "[";
    const open = isImg ? i + 1 : i;

    if (line[open] !== "[") { i++; continue; }

    const close = findMatchingRBracket(line, open);
    if (close < 0 || line[close + 1] !== "(") { i = open + 1; continue; }

    const dest = parseLinkDestination(line, close + 2);
    if (!dest) { i = open + 1; continue; }

    out.push({
      from: isImg ? open - 1 : open,
      to: dest.end,
      urlFrom: dest.urlStart,
      urlTo: dest.urlEnd,
      url: line.slice(dest.urlStart, dest.urlEnd),
    });
    i = dest.end;
  }
  return out;
}

// Genera un texto de reemplazo visual para la URL (ej. "https..." o "www...").
function urlPlaceholder(url) {
  const u = String(url).trim();
  const scheme = /^([a-z][a-z0-9+.-]+):/i.exec(u);
  if (scheme) return `${scheme[1]}...`;
  if (/^www\./i.test(u)) return "www...";
  return null;
}

// Widget de CodeMirror que renderiza el marcador de posición de la URL oculta.
class UrlPlaceholderWidget extends WidgetType {
  constructor(label) {
    super();
    this.label = label;
  }
  eq(other) {
    return other.label === this.label;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "slack-url-hidden";
    span.textContent = this.label;
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

// Efecto personalizado para forzar el redibujado del editor cuando cambian los ajustes.
const urlHiderRefresh = StateEffect.define();

// Crea una extensión de CodeMirror para ocultar visualmente las URLs según la configuración.
function createUrlHiderExtension(plugin) {
  const build = (view) => {
    const builder = new RangeSetBuilder();
    const { hideUrls, hideUrlsRevealOnCursor } = plugin.settings;
    if (!hideUrls) return builder.finish();

    const { state } = view;
    const ranges = state.selection.ranges;
    let nextAllowed = 0;

    for (const vr of view.visibleRanges) {
      let pos = vr.from;
      while (pos <= vr.to) {
        const line = state.doc.lineAt(pos);
        pos = line.to + 1;
        if (line.from < nextAllowed) continue;
        nextAllowed = line.to + 1;

        if (!line.text.includes("](")) continue;

        for (const link of findAllLinkUrls(line.text)) {
          const label = urlPlaceholder(link.url);
          if (!label) continue;

          const absFrom = line.from + link.from;
          const absTo = line.from + link.to;

          // Si el cursor está sobre el enlace y la opción está activa, no lo ocultamos.
          if (hideUrlsRevealOnCursor && ranges.some((r) => r.from <= absTo && r.to >= absFrom)) {
            continue;
          }

          builder.add(
            line.from + link.urlFrom,
            line.from + link.urlTo,
            Decoration.replace({ widget: new UrlPlaceholderWidget(label) }),
          );
        }
      }
    }
    return builder.finish();
  };

  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = build(view);
      }
      update(u) {
        if (
          u.docChanged ||
          u.viewportChanged ||
          u.selectionSet ||
          u.transactions.some((tr) => tr.effects.some((e) => e.is(urlHiderRefresh)))
        ) {
          this.decorations = build(u.view);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      provide: (p) =>
        EditorView.atomicRanges.of((view) => view.plugin(p)?.decorations || Decoration.none),
    },
  );
}

// Determina si el cursor está sobre un enlace existente y extrae su contexto (texto, URL, rango).
function resolveLinkContext(editor) {
  const from = editor.getCursor("from");
  const to = editor.getCursor("to");
  const sel = editor.getSelection();

  if (from.line === to.line) {
    const line = editor.getLine(from.line);
    const probeTo = from.ch === to.ch ? from.ch : Math.max(to.ch - 1, from.ch);
    const atFrom = findMdLinkAt(line, from.ch);
    const atTo = findMdLinkAt(line, probeTo);

    if (atFrom && atTo && atFrom.from === atTo.from && atFrom.to === atTo.to) {
      return {
        isEditing: true,
        displayText: atFrom.text,
        url: atFrom.url,
        title: atFrom.title,
        original: line.slice(atFrom.from, atFrom.to),
        range: {
          from: { line: from.line, ch: atFrom.from },
          to: { line: from.line, ch: atFrom.to },
        },
      };
    }
  }

  return {
    isEditing: false,
    displayText: sel,
    url: looksLikeUrl(sel) ? sel.trim() : "",
    title: "",
    original: sel,
    range: { from, to },
  };
}

// Reemplaza texto en el editor de forma segura, solo si el contenido original no ha cambiado.
const applyReplacement = (editor, range, exp, next) =>
  editor.getRange(range.from, range.to) === exp &&
  (editor.replaceRange(next, range.from, range.to), true);

// Clase que define la ventana modal para añadir o editar enlaces.
class LinkModal extends Modal {
  constructor(app, plugin, ctx, onSubmit, onDelete) {
    super(app);
    this.plugin = plugin;
    this.ctx = ctx;
    this.onSubmit = onSubmit;
    this.onDelete = onDelete;
  }

  // Inicializa y renderiza los elementos de la ventana modal.
  onOpen() {
    const { contentEl: el } = this;
    this.modalEl.addClass("slack-modal");
    el.empty();
    el.createEl("h2", { text: `${this.ctx.isEditing ? "Editar" : "Añadir"} enlace` });

    this.textInput = this.addTextField(el);
    this.urlInput = this.addField(el, "URL (https://...)", this.ctx.url);
    this.errorEl = el.createDiv({ cls: "slack-error", attr: { role: "alert" } });

    const btnGroup = el.createDiv({ cls: "slack-button-group" });
    btnGroup.createEl("button", { text: "Cancelar" }).onclick = () => this.close();
    btnGroup.createEl("button", { text: "Guardar", cls: "mod-cta" }).onclick = () => this.submit();

    if (this.ctx.isEditing) {
      el.createDiv({ cls: "slack-delete-container" })
        .createEl("button", { text: "Eliminar enlace", cls: "slack-delete-btn" })
        .onclick = () => { this.onDelete(); this.close(); };
    }

    (this.ctx.displayText && !this.ctx.url ? this.urlInput : this.textInput).focus();
  }

  // Vincula la tecla Enter para enviar el formulario desde un campo de entrada.
  bindEnter(input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); this.submit(); }
    });
    return input;
  }

  // Crea un campo de entrada de texto estándar con su etiqueta y evento Enter.
  addField(parent, placeholder, value) {
    const wrap = parent.createDiv({ cls: "slack-field" });
    const input = wrap.createEl("input", {
      type: "text",
      placeholder,
      value,
      attr: { "aria-label": placeholder },
    });
    return this.bindEnter(input);
  }

  // Crea el campo de texto principal con un botón para generar un nombre aleatorio (nanoid).
  addTextField(parent) {
    const wrap = parent.createDiv({ cls: "slack-field slack-field-row" });
    const input = this.bindEnter(wrap.createEl("input", {
      type: "text",
      placeholder: "Texto a mostrar",
      value: this.ctx.displayText,
      attr: { "aria-label": "Texto a mostrar" },
    }));

    const btn = wrap.createEl("button", {
      cls: "slack-nanoid-btn",
      attr: { type: "button", "aria-label": "Generar nombre aleatorio", title: "Generar nombre aleatorio" },
    });
    setIcon(btn, "dices");
    btn.onclick = (e) => {
      e.preventDefault();
      const { nanoidSize, nanoidAlphabet } = this.plugin.settings;
      input.value = nanoid(nanoidSize, nanoidAlphabet);
      input.focus();
      input.select();
    };

    return input;
  }

  // Valida y procesa el envío del formulario de la modal.
  submit() {
    const text = this.textInput.value.trim();
    const url = this.urlInput.value.trim();
    if (!url) {
      this.errorEl.setText("Falta la URL.");
      this.urlInput.focus();
      return;
    }
    this.onSubmit(text || url, url);
    this.close();
  }

  // Limpia el contenido de la modal al cerrarse.
  onClose() {
    this.contentEl.empty();
  }
}

// Clase que gestiona la pestaña de configuración del plugin en Obsidian.
class SlackLinkSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // Renderiza los campos de configuración en la interfaz de usuario.
  display() {
    const { containerEl: el } = this;
    el.empty();
    el.createEl("h2", { text: "Enlaces" });

    new Setting(el)
      .setName("Longitud del nombre aleatorio")
      .setDesc(`Número de caracteres que genera el dado (${SIZE_MIN}–${SIZE_MAX}).`)
      .addText((txt) => {
        txt.inputEl.type = "number";
        txt.inputEl.min = String(SIZE_MIN);
        txt.inputEl.max = String(SIZE_MAX);
        txt.setValue(String(this.plugin.settings.nanoidSize))
          .onChange(async (v) => {
            this.plugin.settings.nanoidSize = clampSize(v);
            await this.plugin.saveSettings();
          });
        txt.inputEl.onblur = () => txt.setValue(String(this.plugin.settings.nanoidSize));
      });

    new Setting(el)
      .setName("Alfabeto")
      .setDesc("Caracteres permitidos. Se ignoran espacios y duplicados. Mínimo 2.")
      .addText((txt) => {
        txt.setValue(this.plugin.settings.nanoidAlphabet)
          .onChange(async (v) => {
            this.plugin.settings.nanoidAlphabet = normalizeAlphabet(v);
            await this.plugin.saveSettings();
          });
        txt.inputEl.onblur = () => txt.setValue(this.plugin.settings.nanoidAlphabet);
      });

    new Setting(el)
      .setName("Ocultar URLs de los enlaces")
      .setDesc(
        'Muestra [texto](https://ejemplo.com) como [texto](https...) en el editor. ' +
        "Solo es visual: el archivo no se modifica.",
      )
      .addToggle((tgl) =>
        tgl.setValue(this.plugin.settings.hideUrls).onChange(async (v) => {
          this.plugin.settings.hideUrls = v;
          await this.plugin.saveSettings();
          this.plugin.refreshEditors();
        }),
      );

    new Setting(el)
      .setName("Mostrar la URL al editar el enlace")
      .setDesc(
        "Si el cursor o la selección toca un enlace, se muestra su URL completa. " +
        "Si lo desactivas, la URL permanece siempre oculta.",
      )
      .addToggle((tgl) =>
        tgl.setValue(this.plugin.settings.hideUrlsRevealOnCursor).onChange(async (v) => {
          this.plugin.settings.hideUrlsRevealOnCursor = v;
          await this.plugin.saveSettings();
          this.plugin.refreshEditors();
        }),
      );
  }
}

// Clase principal del plugin de Obsidian.
module.exports = class SlackLinkPlugin extends Plugin {
  // Se ejecuta al cargar el plugin: inicializa ajustes, comandos y extensiones.
  async onload() {
    this.settings = mergeSettings(await this.loadData());

    this.addCommand({
      id: "open-slack-link-modal",
      name: "Add or edit link",
      icon: "link",
      editorCallback: (editor) => this.handleLinkCommand(editor),
    });

    this.registerEditorExtension(createUrlHiderExtension(this));
    this.addSettingTab(new SlackLinkSettingTab(this.app, this));
  }

  // Fuerza a los documentos abiertos a recalcular y aplicar el ocultamiento de URLs.
  refreshEditors() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const cm = leaf.view?.editor?.cm;
      if (cm) cm.dispatch({ effects: urlHiderRefresh.of(null) });
    });
  }

  // Maneja la ejecución del comando: analiza el contexto y abre la ventana modal.
  handleLinkCommand(editor) {
    const ctx = resolveLinkContext(editor);
    new LinkModal(
      this.app,
      this,
      ctx,
      (text, url) => {
        if (!applyReplacement(editor, ctx.range, ctx.original, formatMdLink(text, url, ctx.title))) {
          new Notice("El documento cambió. No se aplicó el enlace.");
        }
      },
      () => {
        if (!applyReplacement(editor, ctx.range, ctx.original, ctx.displayText)) {
          new Notice("El documento cambió. No se eliminó el enlace.");
        }
      },
    ).open();
  }

  // Guarda la configuración actual en el almacenamiento persistente del plugin.
  async saveSettings() {
    await this.saveData(this.settings);
  }
};

