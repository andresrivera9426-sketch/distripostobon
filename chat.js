// Chat v6 (código compartido web + Android). Se usa SOLO si la base reporta version_esquema >= 6;
// si no, app.js mantiene el chat v3 tal cual. Sin cifrado de extremo a extremo, sin llamadas propias, sin push con app cerrada.
(function () {
  const R = window.DPReglas, PAG = 30, URL_SEG = 300;
  const E = { enviando: "⏳ Enviando…", error: "⚠️ No enviado", enviado: "✓ Enviado", visto: "✓✓ Visto" };
  const nombreAutor = x => esc(x.autor?.nombre || "") + (x.autor?.rol && x.autor.rol !== "cliente" ? " · " + ROLES[x.autor.rol] : "");
  const SEL = "*, autor:profiles!mensajes_autor_id_fkey(nombre,rol)";

  async function abrir(box, clienteId, pedidoId) {
    const k = clienteId + (pedidoId || ""), conv = pedidoId || "general", uid = S.user.id;
    const st = { lista: [], reac: {}, lecturas: [], citas: {}, hayMas: false, resp: null, borrador: null, cargando: false };
    box.innerHTML = `<div class="chatbar"><button type="button" class="btn ghost sm" id="cBus" aria-expanded="false">🔍 Buscar</button></div>
      <form id="cBusF" class="send" hidden role="search"><input id="cBusQ" maxlength="80" placeholder="Buscar en esta conversación" aria-label="Buscar en esta conversación"><button class="btn sm">Buscar</button></form>
      <div id="cBusR" class="list" hidden aria-live="polite"></div>
      <div class="msgs" id="msgs" role="log" aria-live="polite" aria-label="Mensajes"><div class="muted small">Cargando…</div></div>
      <div id="cResp" class="cita barra" hidden></div><div id="cPrev" class="adjprev" hidden></div>
      <form class="send" id="fs"><button type="button" class="btn ghost ic" id="cAdj" aria-label="Adjuntar foto o PDF" title="Adjuntar foto o PDF">📎</button>
        <input type="file" id="cFile" accept="image/jpeg,image/png,image/webp,application/pdf" hidden>
        <textarea id="txt" rows="1" maxlength="2000" placeholder="Escribe un mensaje…" aria-label="Mensaje"></textarea>
        <button type="button" class="btn ghost ic" id="cMic" aria-label="Grabar nota de voz" title="Grabar nota de voz">🎤</button>
        <button class="btn ic" aria-label="Enviar mensaje">➤</button></form>
      <p class="muted small">Los adjuntos se guardan en almacenamiento privado y se abren con enlaces temporales. No es cifrado de extremo a extremo.</p>`;
    const msgsEl = $("#msgs");

    // ---------- Carga paginada (keyset por id; un solo canal realtime por conversación) ----------
    const base = () => { let q = sb.from("mensajes").select(SEL).eq("cliente_id", clienteId); return pedidoId ? q.eq("pedido_id", pedidoId) : q.is("pedido_id", null); };
    async function pagina(antesDe) {
      let q = base().order("id", { ascending: false }).limit(PAG + 1); if (antesDe) q = q.lt("id", antesDe);
      const { data, error } = await q; if (error) { toast(errMsg(error), 1); return []; }
      st.hayMas = data.length > PAG; const d = data.slice(0, PAG).reverse(); await extras(d); return d;
    }
    async function extras(d) {
      const ids = d.filter(x => x.id > 0).map(x => x.id); if (!ids.length) return;
      const faltan = [...new Set(d.map(x => x.responde_a).filter(i => i && !st.lista.some(m => m.id === i) && !d.some(m => m.id === i) && !st.citas[i]))];
      const [r, c] = await Promise.all([sb.from("mensaje_reacciones").select("mensaje_id,usuario_id,emoji").in("mensaje_id", ids),
        faltan.length ? sb.from("mensajes").select("id,texto,tipo,adjunto_nombre,eliminado,autor_id").in("id", faltan) : { data: [] }]);
      ids.forEach(i => { st.reac[i] = []; }); (r.data || []).forEach(x => (st.reac[x.mensaje_id] ||= []).push(x)); (c.data || []).forEach(x => { st.citas[x.id] = x; });
    }
    async function lecturas() { const { data } = await sb.from("chat_lecturas").select("usuario_id,ultimo_id").eq("cliente_id", clienteId).eq("conv", conv); st.lecturas = data || []; }
    let ultimoLeido = 0;
    const leer = async () => {
      if (staff()) LS("visto_c_" + k, new Date().toISOString()); else marcarVisto("cliente");
      const u = [...st.lista].reverse().find(x => x.id > 0); if (!u || u.id <= ultimoLeido || document.visibilityState === "hidden") return;
      ultimoLeido = u.id; await sb.rpc("marcar_leido", { c: clienteId, p: pedidoId || null, ultimo: u.id });
    };

    // ---------- Pintar ----------
    const cita = id => { const m = st.lista.find(x => x.id === id) || st.citas[id]; return `<button type="button" class="cita" data-ir="${id}" aria-label="Ir al mensaje citado">${esc(R.resumenCita(m))}</button>`; };
    function contenido(x) {
      if (x.eliminado) return `<p class="muted"><i>🚫 Mensaje eliminado</i></p>`;
      let h = "";
      if (x.tipo === "imagen") h = `<button type="button" class="btn ghost sm" data-ver="${x.id}">📷 Ver foto${x.adjunto_bytes ? " · " + R.tamano(x.adjunto_bytes) : ""}</button>`;
      if (x.tipo === "documento") h = `<button type="button" class="btn ghost sm" data-ver="${x.id}">📄 ${esc(x.adjunto_nombre || "Documento PDF")}${x.adjunto_bytes ? " · " + R.tamano(x.adjunto_bytes) : ""}</button>`;
      if (x.tipo === "voz") h = `<button type="button" class="btn ghost sm" data-ver="${x.id}">▶ Escuchar nota de voz (${x.voz_seg || "?"} s)</button>`;
      if (x._local) h = `<p class="muted small">${x.tipo === "voz" ? "🎤 Nota de voz" : "📎 " + esc(x.adjunto_nombre || "")}</p>`;
      return `<div class="adj" id="adj${x.id}">${h}</div>${x.texto ? `<p>${esc(x.texto)}</p>` : ""}`;
    }
    function reacciones(x) {
      const g = {}; (st.reac[x.id] || []).forEach(r => { (g[r.emoji] ||= []).push(r.usuario_id); });
      return Object.entries(g).map(([e, us]) => `<span class="reac${us.includes(uid) ? " mia" : ""}" aria-label="${e} ${us.length}">${e} ${us.length}</span>`).join("");
    }
    function burbuja(x) {
      const mio = x.autor_id === uid, est = mio ? R.estadoMensaje(x, st.lecturas, uid) : null, vivo = x.id > 0 && !x.eliminado;
      return `<div class="msg ${mio ? "me" : ""}" id="m${x.id}" data-id="${x.id}"><small>${nombreAutor(x)}</small>${x.responde_a ? cita(x.responde_a) : ""}${contenido(x)}
        <div class="reacs">${vivo ? reacciones(x) : ""}</div>
        <time>${fecha(x.creado)}${x.editado && !x.eliminado ? " · editado" : ""}${est ? ` · <span class="est ${est}">${E[est]}</span>` : ""}</time>
        ${x._estado === "error" ? `<button type="button" class="btn sm" data-reint="${x.id}">Reintentar</button> <button type="button" class="btn ghost sm" data-desc="${x.id}">Descartar</button>` : ""}
        ${vivo ? `<button type="button" class="mas" data-menu="${x.id}" aria-label="Opciones del mensaje" aria-haspopup="true">⋯</button>` : ""}</div>`;
    }
    function pintar(alFinal = true) {
      if (!msgsEl.isConnected) return; const h0 = msgsEl.scrollHeight, t0 = msgsEl.scrollTop;
      msgsEl.innerHTML = (st.hayMas ? `<button type="button" class="btn ghost sm" id="cMas">Cargar mensajes anteriores</button>` : "")
        + (st.lista.length ? st.lista.map(burbuja).join("") : `<div class="muted small">Aún no hay mensajes. Escribe el primero.</div>`);
      if (alFinal) msgsEl.scrollTop = msgsEl.scrollHeight; else msgsEl.scrollTop = t0 + (msgsEl.scrollHeight - h0);
    }

    // ---------- Acciones sobre mensajes ----------
    msgsEl.onclick = async e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.id === "cMas") { if (st.cargando) return; st.cargando = true; const d = await pagina(st.lista.find(x => x.id > 0)?.id); st.lista = d.concat(st.lista); st.cargando = false; return pintar(false); }
      if (b.dataset.ir) { const t = document.getElementById("m" + b.dataset.ir); if (t) { t.scrollIntoView({ block: "center" }); t.classList.add("foco"); setTimeout(() => t.classList.remove("foco"), 1500); } else toast("Ese mensaje es anterior: usa «Cargar mensajes anteriores» o Buscar."); return; }
      if (b.dataset.ver) return verAdjunto(+b.dataset.ver);
      if (b.dataset.reint) return reintentar(+b.dataset.reint);
      if (b.dataset.desc) { const x = st.lista.find(m => m.id === +b.dataset.desc); if (x?.adjunto_ruta_ok) sb.storage.from("chat").remove([x.adjunto_ruta]); st.lista = st.lista.filter(m => m !== x); return pintar(); }
      if (b.dataset.menu) return menu(+b.dataset.menu, b);
    };
    async function verAdjunto(id) {
      const x = st.lista.find(m => m.id === id), el = $("#adj" + id); if (!x || !el) return;
      // URL firmada temporal (5 min), solo tras autorización RLS; se pide al tocar para no gastar Storage/datos.
      const { data, error } = await sb.storage.from("chat").createSignedUrl(x.adjunto_ruta, URL_SEG);
      if (error || !data?.signedUrl) return toast(error ? errMsg(error) : "No se pudo abrir el archivo", 1);
      const u = esc(data.signedUrl);
      if (x.tipo === "imagen") el.innerHTML = `<img src="${u}" alt="Foto enviada en el chat" class="adjimg" loading="lazy">`;
      else if (x.tipo === "voz") el.innerHTML = `<audio controls preload="none" src="${u}" aria-label="Nota de voz de ${x.voz_seg || ""} segundos"></audio>`;
      else el.innerHTML = `<a class="btn ghost sm" href="${u}" target="_blank" rel="noopener noreferrer" download="${esc(x.adjunto_nombre || "documento.pdf")}">📄 Abrir ${esc(x.adjunto_nombre || "PDF")}</a><small class="muted"> Enlace válido 5 min</small>`;
    }
    function menu(id, ancla) {
      document.querySelector(".menuMsg")?.remove();
      const x = st.lista.find(m => m.id === id); if (!x) return;
      const mia = (st.reac[id] || []).find(r => r.usuario_id === uid)?.emoji;
      const m = document.createElement("div"); m.className = "menuMsg"; m.setAttribute("role", "menu");
      m.innerHTML = `<div class="emo" role="group" aria-label="Reaccionar">${R.REACCIONES.map(e => `<button type="button" role="menuitem" data-e="${e}" class="${mia === e ? "on" : ""}" aria-label="Reaccionar ${e}${mia === e ? " (quitar)" : ""}">${e}</button>`).join("")}</div>
        <button type="button" role="menuitem" data-a="resp">↩ Responder</button>${R.puedeEditar(x, uid) ? `<button type="button" role="menuitem" data-a="edit">✏️ Editar</button>` : ""}
        ${R.puedeEliminar(x, uid, rol()) ? `<button type="button" role="menuitem" data-a="del">🗑 Eliminar para todos</button>` : ""}<button type="button" role="menuitem" data-a="x">Cerrar</button>`;
      ancla.closest(".msg").appendChild(m); m.querySelector("button").focus();
      m.onclick = async e => { const b = e.target.closest("button"); if (!b) return; e.stopPropagation(); m.remove();
        if (b.dataset.e) return reaccionar(id, b.dataset.e === mia ? null : b.dataset.e);
        if (b.dataset.a === "resp") { st.resp = id; pintarResp(); return $("#txt").focus(); }
        if (b.dataset.a === "edit") { const t = prompt("Editar mensaje (máximo 15 minutos después de enviarlo):", x.texto); if (t == null || !t.trim() || t.trim() === x.texto) return;
          const { error } = await sb.rpc("editar_mensaje", { m: id, nuevo: t.trim() }); if (error) return toast(errMsg(error), 1); x.texto = t.trim(); x.editado = new Date().toISOString(); return pintar(false); }
        if (b.dataset.a === "del") { if (!confirm("¿Eliminar este mensaje para todos? Quedará «Mensaje eliminado» en la conversación y una copia en el registro de auditoría del administrador.")) return;
          const { error } = await sb.rpc("eliminar_mensaje", { m: id }); if (error) return toast(errMsg(error), 1); Object.assign(x, { eliminado: new Date().toISOString(), texto: "" }); st.reac[id] = []; return pintar(false); } };
    }
    async function reaccionar(id, emoji) {
      const r = emoji ? await sb.from("mensaje_reacciones").upsert({ mensaje_id: id, usuario_id: uid, emoji }, { onConflict: "mensaje_id,usuario_id" })
        : await sb.from("mensaje_reacciones").delete().eq("mensaje_id", id).eq("usuario_id", uid);
      if (r.error) return toast(errMsg(r.error), 1);
      st.reac[id] = (st.reac[id] || []).filter(x => x.usuario_id !== uid).concat(emoji ? [{ mensaje_id: id, usuario_id: uid, emoji }] : []); pintar(false);
    }
    function pintarResp() {
      const el = $("#cResp"); if (!st.resp) { el.hidden = true; el.innerHTML = ""; return; }
      const m = st.lista.find(x => x.id === st.resp); el.hidden = false;
      el.innerHTML = `<span>↩ Respondiendo a: ${esc(R.resumenCita(m))}</span> <button type="button" class="btn ghost sm" id="cRespX" aria-label="Cancelar respuesta">✕</button>`;
      $("#cRespX").onclick = () => { st.resp = null; pintarResp(); };
    }

    // ---------- Envío con estado, error y reintento ----------
    let tmp = -1;
    async function enviar(loc) {
      loc._estado = "enviando"; pintar();
      try {
        if (loc._blob && !loc.adjunto_ruta_ok) {
          const { error } = await sb.storage.from("chat").upload(loc.adjunto_ruta, loc._blob, { contentType: loc.adjunto_mime, upsert: false, cacheControl: "3600" });
          if (error) throw error; loc.adjunto_ruta_ok = true;
        }
        const fila = { cliente_id: clienteId, pedido_id: pedidoId || null, autor_id: uid, texto: loc.texto, responde_a: loc.responde_a || null, tipo: loc.tipo,
          adjunto_ruta: loc._blob ? loc.adjunto_ruta : null, adjunto_mime: loc._blob ? loc.adjunto_mime : null, adjunto_bytes: loc._blob ? loc.adjunto_bytes : null,
          adjunto_nombre: loc._blob ? loc.adjunto_nombre : null, voz_seg: loc.tipo === "voz" ? loc.voz_seg : null };
        const { data: n, error } = await sb.from("mensajes").insert(fila).select(SEL).single(); if (error) throw error;
        const i = st.lista.indexOf(loc); const real = st.lista.find(x => x.id === n.id);
        if (i < 0) { if (!real) st.lista.push(n); } else if (real) st.lista.splice(i, 1); else st.lista[i] = n; st.reac[n.id] = []; pintar();
      } catch (err) { loc._estado = "error"; loc._err = errMsg(err); pintar(); toast("No se envió: " + loc._err, 1); }
    }
    function reintentar(id) { const x = st.lista.find(m => m.id === id); if (x) enviar(x); }
    function nuevoLocal(extra) {
      const x = { id: tmp--, _local: true, autor_id: uid, autor: { nombre: S.perfil.nombre, rol: S.perfil.rol }, creado: new Date().toISOString(), texto: "", tipo: "texto", responde_a: st.resp, ...extra };
      st.resp = null; pintarResp(); st.lista.push(x); return x;
    }
    $("#fs").onsubmit = e => {
      e.preventDefault(); const t = $("#txt").value.trim();
      if (st.borrador) { const d = st.borrador; st.borrador = null; limpiarPrev(); $("#txt").value = ""; return enviar(nuevoLocal({ ...d, texto: t.slice(0, 2000) })); }
      if (!t) return; $("#txt").value = ""; enviar(nuevoLocal({ texto: t }));
    };
    $("#txt").onkeydown = e => { if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer:coarse)").matches) { e.preventDefault(); $("#fs").requestSubmit(); } };

    // ---------- Adjuntos: vista previa y envío SOLO al tocar Enviar ----------
    const ruta = ext => `${clienteId}/${crypto.randomUUID()}.${ext}`;
    function limpiarPrev() { const p = $("#cPrev"); if (!p) return; p.querySelectorAll("[data-url]").forEach(el => URL.revokeObjectURL(el.dataset.url)); p.hidden = true; p.innerHTML = ""; }
    function mostrarBorrador(d, url) {
      st.borrador = d; const p = $("#cPrev"); p.hidden = false;
      p.innerHTML = `<div class="row"><div class="grow">${d.tipo === "imagen" ? `<img src="${url}" data-url="${url}" alt="Vista previa de la foto" class="adjimg">` : d.tipo === "voz" ? `<audio controls src="${url}" data-url="${url}" aria-label="Escuchar antes de enviar"></audio><small>🎤 ${d.voz_seg} s</small>` : `<b>📄 ${esc(d.adjunto_nombre)}</b>`}
        <small class="muted">${R.tamano(d.adjunto_bytes)} · se envía al tocar ➤ (puedes añadir un texto)</small></div><button type="button" class="btn ghost sm" id="cPrevX">Descartar</button></div>`;
      $("#cPrevX").onclick = () => { st.borrador = null; limpiarPrev(); };
    }
    $("#cAdj").onclick = () => $("#cFile").click();
    $("#cFile").onchange = e => {
      const f = e.target.files[0]; e.target.value = ""; if (!f) return; const v = R.validarAdjunto(f);
      if (!v.ok) return toast(v.error, 1); limpiarPrev();
      mostrarBorrador({ tipo: v.tipo, _blob: f, adjunto_mime: v.mime, adjunto_bytes: f.size, adjunto_nombre: (f.name || "archivo").slice(0, 120), adjunto_ruta: ruta(v.ext) }, v.tipo === "imagen" ? URL.createObjectURL(f) : "");
    };

    // ---------- Nota de voz: tocar para grabar, tocar para detener, escuchar, enviar o descartar ----------
    const fmt = window.MediaRecorder && navigator.mediaDevices?.getUserMedia ? R.formatoVoz(m => MediaRecorder.isTypeSupported(m)) : null;
    let rec = null;
    if (!fmt) { $("#cMic").disabled = true; $("#cMic").title = "Este dispositivo o navegador no permite grabar notas de voz aquí"; $("#cMic").setAttribute("aria-label", "Notas de voz no disponibles en este dispositivo"); }
    $("#cMic").onclick = async () => {
      if (!fmt) return toast("Este dispositivo no permite grabar notas de voz desde la app.", 1);
      if (rec) return rec.stop();
      let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (err) { return toast("Sin permiso de micrófono. Puedes activarlo en los ajustes del navegador o del teléfono.", 1); }
      const partes = [], t0 = Date.now(); limpiarPrev(); st.borrador = null;
      rec = new MediaRecorder(stream, { mimeType: fmt.grabar, audioBitsPerSecond: 32000 });
      rec.ondataavailable = ev => ev.data.size && partes.push(ev.data);
      const tic = setInterval(() => { const s = Math.round((Date.now() - t0) / 1000); $("#cMic") && ($("#cMic").textContent = "⏹ " + s + " s"); if (s >= R.MAX_VOZ_SEG && rec) rec.stop(); }, 500);
      rec.onstop = () => {
        clearInterval(tic); stream.getTracks().forEach(t => t.stop()); rec = null; const mic = $("#cMic"); if (!mic) return;
        mic.textContent = "🎤"; mic.setAttribute("aria-label", "Grabar nota de voz"); mic.classList.remove("grabando");
        const seg = Math.max(1, Math.min(R.MAX_VOZ_SEG, Math.round((Date.now() - t0) / 1000))), blob = new Blob(partes, { type: fmt.mime }), v = R.validarAdjunto(blob, true);
        if (!v.ok) return toast(v.error, 1);
        mostrarBorrador({ tipo: "voz", _blob: blob, adjunto_mime: v.mime, adjunto_bytes: blob.size, adjunto_nombre: "nota-de-voz." + v.ext, voz_seg: seg, adjunto_ruta: ruta(v.ext) }, URL.createObjectURL(blob));
      };
      rec.start(1000); const mic = $("#cMic"); mic.classList.add("grabando"); mic.setAttribute("aria-label", "Detener grabación"); toast("Grabando… toca ⏹ para detener. No se envía hasta que toques ➤.");
    };

    // ---------- Búsqueda (en servidor, solo en esta conversación, máx. 30 resultados) ----------
    $("#cBus").onclick = () => { const f = $("#cBusF"), ab = f.hidden; f.hidden = !ab; $("#cBusR").hidden = !ab; $("#cBus").setAttribute("aria-expanded", String(ab)); if (ab) $("#cBusQ").focus(); };
    $("#cBusF").onsubmit = async e => {
      e.preventDefault(); const t = $("#cBusQ").value.trim().replace(/[%_\\,()]/g, " ").trim(), out = $("#cBusR"); if (t.length < 2) return toast("Escribe al menos 2 letras", 1);
      const { data, error } = await base().is("eliminado", null).ilike("texto", "%" + t + "%").order("id", { ascending: false }).limit(30);
      if (error) return toast(errMsg(error), 1);
      out.innerHTML = data.length ? data.map(x => `<button type="button" class="row" data-ir="${x.id}"><div class="grow"><b>${esc(x.autor?.nombre || "")}</b><small>${esc(R.resumenCita(x))} · ${fecha(x.creado)}</small></div></button>`).join("") : `<p class="muted small">Sin resultados.</p>`;
    };
    $("#cBusR").onclick = async e => {
      const b = e.target.closest("[data-ir]"); if (!b) return; const id = +b.dataset.ir;
      while (!st.lista.some(x => x.id === id) && st.hayMas) { const d = await pagina(st.lista.find(x => x.id > 0)?.id); st.lista = d.concat(st.lista); }
      pintar(false); const t = document.getElementById("m" + id); if (t) { t.scrollIntoView({ block: "center" }); t.classList.add("foco"); setTimeout(() => t.classList.remove("foco"), 1500); }
    };

    // ---------- Inicio + tiempo real (1 canal; recargas puntuales, nunca por mensaje visible) ----------
    st.lista = await pagina(); await lecturas(); if (!msgsEl.isConnected) return; pintar(); leer();
    const filtro = "cliente_id=eq." + clienteId, deEsta = r => (r.pedido_id || null) === (pedidoId || null);
    S.chatSub = sb.channel("chat6-" + k + Date.now())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mensajes", filter: filtro }, async p => {
        if (!deEsta(p.new) || st.lista.some(x => x.id === p.new.id)) return;
        const { data: n } = await sb.from("mensajes").select(SEL).eq("id", p.new.id).single(); if (!n || st.lista.some(x => x.id === n.id)) return;
        if (n.autor_id === uid && st.lista.some(x => x._estado === "enviando")) return; // lo coloca enviar()
        await extras([n]); st.lista.push(n); pintar(); if (n.autor_id !== uid) { sonar(); leer(); }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "mensajes", filter: filtro }, p => {
        const x = st.lista.find(m => m.id === p.new.id); if (!x) return; Object.assign(x, { texto: p.new.texto, editado: p.new.editado, eliminado: p.new.eliminado }); if (x.eliminado) st.reac[x.id] = []; pintar(false);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "mensaje_reacciones", filter: filtro }, async p => {
        const id = (p.new && p.new.mensaje_id) || (p.old && p.old.mensaje_id); if (!st.lista.some(x => x.id === id)) return;
        const { data } = await sb.from("mensaje_reacciones").select("mensaje_id,usuario_id,emoji").eq("mensaje_id", id); st.reac[id] = data || []; pintar(false);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_lecturas", filter: filtro }, p => {
        if (!p.new || p.new.conv !== conv) return; st.lecturas = st.lecturas.filter(l => l.usuario_id !== p.new.usuario_id).concat([p.new]); pintar(false);
      }).subscribe();
  }
  /** Aviso honesto en el chat v3 cuando la base aún no tiene v6 (solo administración lo ve). */
  function avisoPendiente() {
    if (rol() !== "administrador") return "";
    return `<p class="note warn small">Chat mejorado (respuestas, reacciones, búsqueda, fotos/PDF, notas de voz, editar/eliminar, «visto») pendiente de activación: la base está en v${R.capacidades(S.config).esquema} y necesita v6. Este chat funciona en modo básico. <a href="#/admin/estado">Ver estado</a></p>`;
  }
  window.DPChat = { abrir, avisoPendiente };
})();
