import {
  CODECS,
  UNAVAILABLE_MESSAGE,
  UNSUPPORTED_MESSAGE,
  codecLabel,
  formatInteger,
  formatMebibytes,
  representativeFfmpegCommands,
  requireElement,
  requireMapValue,
  supportLabel
} from "./codec-demo-model.js";

export function createCodecDemoView(hotspotUrl) {
  const tabs = new Map(CODECS.map((codec) => [
    codec,
    requireElement(`[role="tab"][data-codec="${codec}"]`)
  ]));
  const panels = new Map(CODECS.map((codec) => [
    codec,
    requireElement(`[role="tabpanel"][data-codec="${codec}"]`)
  ]));
  const panelParts = new Map(CODECS.map((codec) => [
    codec,
    createPanelShell(codec, requireMapValue(panels, codec))
  ]));
  const probeStatus = requireElement("#probe-status");

  selectTab("av1", tabs, panels);

  return Object.freeze({
    bindTabs(onActivate) {
      for (const [codec, tab] of tabs) bindTab(codec, tab, tabs, onActivate);
    },
    selectTab(codec) {
      selectTab(codec, tabs, panels);
    },
    parts(codec) {
      return requireMapValue(panelParts, codec);
    },
    renderBuildDetails(report) {
      for (const codec of CODECS) {
        const parts = requireMapValue(panelParts, codec);
        const asset = requireMapValue(report.assets, codec);
        const encoding = requireMapValue(report.encodings, codec);
        parts.assetName.textContent = asset.path;
        parts.assetBytes.textContent =
          `${formatMebibytes(asset.bytes)} MiB · ${formatInteger(asset.bytes)} bytes`;
        parts.assetBytes.dataset.bytes = String(asset.bytes);
        parts.codecString.textContent = asset.codecString;
        parts.encoding.textContent = JSON.stringify(encoding, null, 2);
        parts.command.textContent = representativeFfmpegCommands(report, codec);
      }
    },
    renderReportFailure() {
      probeStatus.textContent = "Codec details could not be loaded.";
      probeStatus.dataset.state = "unavailable";
      for (const codec of CODECS) {
        setPanelMessage(requireMapValue(panelParts, codec), UNAVAILABLE_MESSAGE);
      }
    },
    renderSupport(codec, state) {
      const tab = requireMapValue(tabs, codec);
      const parts = requireMapValue(panelParts, codec);
      tab.dataset.support = state;
      requireElement("[data-tab-support]", tab).textContent = supportLabel(state);
      parts.supportBadge.dataset.state = state;
      parts.supportBadge.textContent = supportLabel(state);
      if (state === "unsupported") {
        setPanelMessage(parts, UNSUPPORTED_MESSAGE, "unsupported");
      } else if (state === "unavailable") {
        setPanelMessage(parts, UNAVAILABLE_MESSAGE);
      } else {
        parts.stage.dataset.state = "idle";
        parts.message.textContent = "Select this codec to load its standalone AVAL source.";
      }
    },
    renderSupportSummary(supportedCount) {
      probeStatus.textContent = supportedCount === 1
        ? "Support check complete · 1 of 4 codecs is available."
        : `Support check complete · ${String(supportedCount)} of 4 codecs are available.`;
      probeStatus.dataset.state = supportedCount > 0 ? "complete" : "unavailable";
    },
    reset(codec) {
      resetPanelPresentation(requireMapValue(panelParts, codec));
    },
    setMessage(codec, value, state = "unavailable") {
      setPanelMessage(requireMapValue(panelParts, codec), value, state);
    },
    createHotspot() {
      const hotspot = document.createElement("span");
      hotspot.className = "interaction-hotspot";
      hotspot.setAttribute("aria-hidden", "true");
      const image = document.createElement("img");
      image.src = hotspotUrl.href;
      image.alt = "";
      image.draggable = false;
      hotspot.append(image);
      return hotspot;
    }
  });
}

function bindTab(codec, tab, tabs, onActivate) {
  tab.addEventListener("click", () => {
    void onActivate(codec).catch(() => undefined);
  });
  tab.addEventListener("keydown", (event) => {
    const currentIndex = CODECS.indexOf(codec);
    let nextIndex = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % CODECS.length;
    if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + CODECS.length) % CODECS.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = CODECS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextCodec = CODECS[nextIndex];
    const nextTab = requireMapValue(tabs, nextCodec);
    setRovingTabStop(nextCodec, tabs);
    nextTab.focus();
    nextTab.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}

function selectTab(codec, tabs, panels) {
  for (const family of CODECS) {
    const selected = family === codec;
    const tab = requireMapValue(tabs, family);
    const panel = requireMapValue(panels, family);
    tab.setAttribute("aria-selected", selected ? "true" : "false");
    tab.tabIndex = selected ? 0 : -1;
    panel.hidden = !selected;
    panel.toggleAttribute("inert", !selected);
  }
}

function setRovingTabStop(codec, tabs) {
  for (const family of CODECS) {
    requireMapValue(tabs, family).tabIndex = family === codec ? 0 : -1;
  }
}

function createPanelShell(codec, panel) {
  const label = codecLabel(codec);
  const layout = element("div", "panel-layout");
  const preview = element("div", "preview-column");
  const titleRow = element("div", "preview-heading");
  const heading = document.createElement("h3");
  heading.textContent = `${label} at 1280 × 720`;
  const supportBadge = element("span", "support-badge");
  supportBadge.dataset.supportBadge = "";
  supportBadge.dataset.state = "unavailable";
  supportBadge.textContent = "Checking";
  titleRow.append(heading, supportBadge);

  const stage = element("div", "player-stage");
  stage.dataset.playerStage = "";
  stage.dataset.state = "checking";
  const mount = element("div", "player-mount");
  mount.dataset.playerMount = "";
  const message = element("p", "player-message");
  message.dataset.playerMessage = "";
  message.setAttribute("role", "status");
  message.textContent = "Checking exact browser support…";
  stage.append(mount, message);

  const stateRow = element("div", "state-row");
  const stateBadge = element("p", "state-badge");
  stateBadge.dataset.stateBadge = "";
  stateBadge.textContent = "loading";
  stateRow.append(stateBadge);
  preview.append(titleRow, stage, stateRow);

  const details = createEncodingCard(codec);
  layout.append(preview, details.card);
  panel.replaceChildren(layout);
  return Object.freeze({ panel, stage, mount, message, stateBadge, supportBadge, ...details });
}

function createEncodingCard(codec) {
  const card = element("aside", "encoding-card");
  card.setAttribute("aria-label", `${codecLabel(codec)} encoding details`);
  const facts = element("dl", "asset-facts");
  facts.append(
    descriptionPair("Asset", "—", "asset-name"),
    descriptionPair("File size", "—", "asset-bytes"),
    descriptionPair("Codec string", "—", "codec-string")
  );
  const compileCommand = element("pre", "code-block command-block");
  compileCommand.textContent = "avl compile motion.json --out public/grass-rabbit --force";
  const encoding = element("pre", "code-block");
  encoding.dataset.encoding = "";
  encoding.textContent = "Loading build report…";
  const command = element("pre", "code-block command-block");
  command.dataset.ffmpeg = "";
  command.textContent = "Loading build report…";
  card.append(
    facts,
    heading("Compiler command"),
    compileCommand,
    heading("Exact project encoding"),
    encoding,
    heading("Representative compiler FFmpeg pipeline"),
    command
  );
  return {
    card,
    assetName: requireElement("[data-field='asset-name']", facts),
    assetBytes: requireElement("[data-field='asset-bytes']", facts),
    codecString: requireElement("[data-field='codec-string']", facts),
    encoding,
    command
  };
}

function heading(value) {
  const result = document.createElement("h4");
  result.textContent = value;
  return result;
}

function descriptionPair(term, value, field) {
  const wrapper = document.createElement("div");
  const dt = document.createElement("dt");
  dt.textContent = term;
  const dd = document.createElement("dd");
  dd.dataset.field = field;
  dd.textContent = value;
  wrapper.append(dt, dd);
  return wrapper;
}

function element(tag, className) {
  const result = document.createElement(tag);
  result.className = className;
  return result;
}

function resetPanelPresentation(parts) {
  parts.mount.replaceChildren();
  parts.message.textContent = "";
  parts.stateBadge.textContent = "loading";
  parts.stateBadge.removeAttribute("data-visible");
  parts.stage.removeAttribute("aria-busy");
  delete parts.stage.dataset.runtimeError;
}

function setPanelMessage(parts, value, state = "unavailable") {
  parts.stage.dataset.state = state;
  parts.message.textContent = value;
}
