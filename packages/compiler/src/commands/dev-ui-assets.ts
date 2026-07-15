export const DEV_CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
export const DEV_WORKER_CONTENT_SECURITY_POLICY = "default-src 'none'; script-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'";

export const DEV_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>AVAL dev</title>
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <h1>AVAL dev</h1>
  <p id="status" aria-live="polite">Waiting for a valid build…</p>
  <main>
    <section id="stage">
      <div class="preview">
        <button id="interaction" type="button">
          <aval-player id="motion" interaction-for="interaction"><span slot="fallback">Compile to preview</span></aval-player>
          <span>Interaction target</span>
        </button>
      </div>
      <p class="hint">Scroll this preview fully outside the viewport and back to verify suspension and seamless recovery.</p>
      <div class="controls" id="controls">
        <select id="state" aria-label="State"></select>
        <select id="event" aria-label="Event"></select>
        <button id="send" type="button">Send event</button>
        <button id="pause" type="button">Pause</button>
        <button id="resume" type="button">Resume</button>
        <button id="replace" type="button">Replace source</button>
        <button id="stress" type="button">Run stress burst</button>
        <button id="clear-stress" type="button">Clear stress copies</button>
        <button id="capture-trace" type="button">Capture diagnostics trace</button>
        <select id="motion-policy" aria-label="Motion"><option>auto</option><option>reduce</option><option>full</option></select>
        <select id="fit" aria-label="Fit"><option>contain</option><option>cover</option><option>fill</option><option>none</option></select>
        <select id="autoplay" aria-label="Autoplay"><option>visible</option><option>manual</option></select>
        <select id="bindings" aria-label="Bindings"><option>auto</option><option>none</option></select>
        <input id="size" aria-label="Size" type="range" min="64" max="512" value="256">
      </div>
      <h2>Build map</h2>
      <dl id="summary" class="summary"></dl>
      <div id="timeline" class="timeline" role="img" aria-label="No compiled units yet"></div>
    </section>
    <section><h2>Compiler and public diagnostics</h2><pre id="report"></pre></section>
  </main>
  <script type="module" src="./client.js"></script>
</body>
</html>`;

export const DEV_CSS = `:root{color-scheme:light dark}body{font:14px system-ui;margin:2rem;color:#172033;background:#fff}main{display:grid;grid-template-columns:minmax(280px,40vw) 1fr;gap:1.5rem}.preview{min-height:280px;display:grid;place-items:center;border:1px solid #d4d9e3;border-radius:.75rem;background:repeating-conic-gradient(#f7f8fb 0 25%,#eef1f6 0 50%) 0/24px 24px}.preview button{background:color-mix(in srgb,Canvas 88%,transparent);border:1px solid #7d8799;border-radius:.6rem;padding:.75rem}aval-player{display:block;width:256px;max-width:100%;aspect-ratio:1;border:1px solid #aab3c5;background:#f2f4f8}.hint{color:#566176}.controls{display:flex;flex-wrap:wrap;gap:.5rem;margin:.75rem 0}button,select,input{font:inherit}.summary{display:grid;grid-template-columns:max-content 1fr;gap:.3rem 1rem}.summary dt{font-weight:600}.summary dd{margin:0;font-variant-numeric:tabular-nums}.timeline{display:flex;min-height:3.25rem;border:1px solid #aab3c5;border-radius:.4rem;overflow:hidden;background:#f2f4f8}.unit{display:grid;place-items:center;min-width:2px;padding:.3rem;border-inline-end:1px solid #fff8;text-align:center;font-size:.75rem;overflow:hidden}.unit:nth-child(3n+1){background:#c5d8ff}.unit:nth-child(3n+2){background:#ccebdc}.unit:nth-child(3n){background:#f4d5af}pre{white-space:pre-wrap;max-height:70vh;overflow:auto;background:#f2f4f8;padding:1rem;border-radius:.5rem}@media(prefers-color-scheme:dark){body{color:#e9edf5;background:#11151c}.preview{border-color:#465063;background:repeating-conic-gradient(#1c222d 0 25%,#171c25 0 50%) 0/24px 24px}.hint{color:#aeb8c8}aval-player,pre,.timeline{background:#1c222d;border-color:#566176}.unit{color:#11151c}}@media(max-width:800px){main{grid-template-columns:1fr}}`;

export const DEV_CLIENT = `import "./modules/element/auto.js";
const byId=(id)=>document.getElementById(id);
const status=byId("status"),report=byId("report"),motion=byId("motion"),state=byId("state"),event=byId("event"),summary=byId("summary"),timeline=byId("timeline");
const sessionBase=new URL("./",import.meta.url);
let build=null,replacement=0,capturedTrace=null;
const fill=(select,values)=>{select.replaceChildren(...values.map(value=>{const option=document.createElement("option");option.value=value;option.textContent=value;return option;}));};
const redact=(value)=>JSON.parse(JSON.stringify(value,(_key,item)=>typeof item==="string"?item.split(sessionBase.href).join("./"):item));
const replaceSummary=(pairs)=>{summary.replaceChildren(...pairs.flatMap(([name,value])=>{const term=document.createElement("dt"),description=document.createElement("dd");term.textContent=name;description.textContent=String(value);return[term,description];}));};
const renderTimeline=()=>{const units=build?.report?.units??[];const end=Math.max(1,...units.map(unit=>unit.frameRange[1]));timeline.replaceChildren(...units.map(unit=>{const segment=document.createElement("div");segment.className="unit";segment.style.flex=String(Math.max(1,unit.frameRange[1]-unit.frameRange[0]));segment.textContent=unit.id;segment.title=unit.id+" · "+unit.kind+" · frames "+unit.frameRange.join("–")+" · "+unit.timeRange.join("–");return segment;}));timeline.setAttribute("aria-label",units.length?"Compiled unit frame map, 0 through "+String(end):"No compiled units yet");};
const render=(capture=false)=>{const diagnostics=motion.getDiagnostics({trace:false}),presentation=diagnostics.presentation,runtime=diagnostics.runtime,compiler=build?.report;if(capture)capturedTrace=redact(motion.getDiagnostics({trace:true}));replaceSummary([["Generation",build?.generation??"—"],["Asset",build?String(build.bytes)+" bytes · "+build.sha256.slice(0,12):"—"],["Frames",compiler?.frameRate??"—"],["Geometry",compiler?compiler.geometry.visibleWidth+"×"+compiler.geometry.visibleHeight+" visible · "+compiler.geometry.codedWidth+"×"+compiler.geometry.codedHeight+" coded":"—"],["Continuity",compiler?String(compiler.continuityPassed)+" passed · "+String(compiler.continuityCuts)+" declared cuts":"—"],["State",String(diagnostics.visualState??"—")+(diagnostics.isTransitioning?" · transitioning":"")],["Readiness",diagnostics.readiness],["Visibility",diagnostics.effectivelyVisible?"visible":"suspended/offscreen"],["Presentation",presentation?presentation.backingWidth+"×"+presentation.backingHeight+" · DPR "+presentation.effectiveDprX+"×"+presentation.effectiveDprY:"—"],["Decoder",runtime?.decoderLeaseState??"—"]]);report.textContent=JSON.stringify(redact({build,states:motion.stateNames,events:motion.eventNames,bindings:motion.inputBindings,diagnostics,capturedTrace}),null,2);};
const refresh=async(next)=>{build=next;motion.src=next.src;renderTimeline();try{await motion.prepare();fill(state,[...motion.stateNames]);fill(event,[...motion.eventNames]);status.textContent="Build "+next.generation+" · "+motion.readiness;}catch{status.textContent="Build "+next.generation+" retained fallback";}render();};
new EventSource(new URL("./events",import.meta.url)).addEventListener("build",message=>{void refresh(JSON.parse(message.data));});
byId("send").onclick=()=>motion.send(event.value);
state.onchange=()=>{void motion.setState(state.value);};
byId("pause").onclick=()=>motion.pause();
byId("resume").onclick=()=>{void motion.resume();};
byId("replace").onclick=()=>{if(build){replacement+=1;motion.src=build.src.split("#")[0]+"#replace-"+String(replacement);}};
byId("stress").onclick=()=>{if(!build)return;for(let index=0;index<6;index+=1){const copy=motion.cloneNode(true);copy.classList.add("stress-copy");copy.removeAttribute("id");copy.removeAttribute("interaction-for");copy.src=build.src.split("#")[0]+"#stress-"+String(replacement)+"-"+String(index);motion.parentElement.after(copy);void copy.prepare().then(()=>{const names=[...copy.stateNames];if(names.length>1)void copy.setState(names.at(-1));copy.pause();void copy.resume();}).catch(()=>undefined);}replacement+=1;};
byId("clear-stress").onclick=()=>{for(const copy of document.querySelectorAll("aval-player.stress-copy")){void copy.dispose();copy.remove();}};
byId("capture-trace").onclick=()=>render(true);
byId("motion-policy").onchange=e=>{motion.motion=e.target.value;};
byId("fit").onchange=e=>{motion.fit=e.target.value;};
byId("autoplay").onchange=e=>{motion.autoplay=e.target.value;};
byId("bindings").onchange=e=>{motion.bindings=e.target.value;};
byId("size").oninput=e=>{motion.style.width=e.target.value+"px";};
for(const name of ["readinesschange","requestedstatechange","visualstatechange","transitionstart","transitionend","underflow","fallback","error"]){motion.addEventListener(name,render);}
const timer=setInterval(render,250);addEventListener("pagehide",()=>clearInterval(timer),{once:true});`;
