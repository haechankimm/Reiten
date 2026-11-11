  /* 사진 편집기(자르기·회전·확대) — 상품·룩북 공용 (2026-11-11 큰 파일 나누기 — 내용·순서는 그대로) */

  /* ---------- 사진 편집(자르기/회전/확대) ----------
     상품 사진은 세로 4:5(실제 쇼핑몰 카드·상세 페이지가 이 비율로 보여주기 때문 — 정사각으로
     자르면 관리자 미리보기에선 멀쩡해 보여도 실제 사이트에선 위아래 여백이 뜨거나 어색하게
     보인다), 룩북 사진은 그 칸에 고른 가로세로 비율로 미리 잘라서 올린다 —
     Cloudinary가 업로드 후 리사이즈는 해주지만 "어디를 잘라낼지"는 모르기 때문에, 실제로
     보일 영역을 여기서 캔버스로 직접 그려 잘라낸 이미지를 만든 뒤 그걸 업로드한다.
     자유 드래그로 잘라낼 영역을 고르는 대신, 고정된 틀(frame) 안에서 사진을 확대/이동/회전하는
     방식(인스타그램 업로드 편집과 같은 방식)을 써서 구현을 단순하게 유지한다. */
  const peState = { img: null, url: null, rotation: 0, zoom: 1, offsetX: 0, offsetY: 0, frameW: 320, frameH: 320, baseScale: 1, onDone: null };

  function peRatioToNumber(ratio) {
    const [w, h] = String(ratio || "1/1").split("/").map(Number);
    return w > 0 && h > 0 ? w / h : 1;
  }

  function peFitImageToFrame() {
    const rad = (peState.rotation * Math.PI) / 180;
    const iw = peState.img.naturalWidth, ih = peState.img.naturalHeight;
    const rw = Math.abs(iw * Math.cos(rad)) + Math.abs(ih * Math.sin(rad));
    const rh = Math.abs(iw * Math.sin(rad)) + Math.abs(ih * Math.cos(rad));
    peState.baseScale = Math.max(peState.frameW / rw, peState.frameH / rh);
  }

  function peDraw(ctx, w, h, outputScale) {
    ctx.clearRect(0, 0, w, h);
    /* 100% 미만으로 축소하면(원본 비율을 살리려고 프레임보다 작게 줄이는 경우) 사진이 프레임을
       다 못 채워 빈 자리가 생긴다 — 채워두지 않으면 JPEG로 저장할 때 투명 영역이 검은색으로
       바뀌어버리므로 흰 배경을 먼저 깔아둔다. */
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2 + peState.offsetX * outputScale, h / 2 + peState.offsetY * outputScale);
    ctx.rotate((peState.rotation * Math.PI) / 180);
    const scale = peState.baseScale * peState.zoom * outputScale;
    const iw = peState.img.naturalWidth * scale, ih = peState.img.naturalHeight * scale;
    ctx.drawImage(peState.img, -iw / 2, -ih / 2, iw, ih);
    ctx.restore();
  }

  function peRedraw() {
    const canvas = el("pe-canvas");
    peDraw(canvas.getContext("2d"), canvas.width, canvas.height, 1);
  }

  /* 확대·이동을 해도 프레임 밖으로 사진이 완전히 빠져나가지 않도록 이동 범위를 제한한다. */
  function peClampOffset() {
    const rad = (peState.rotation * Math.PI) / 180;
    const iw = peState.img.naturalWidth, ih = peState.img.naturalHeight;
    const scale = peState.baseScale * peState.zoom;
    const rw = (Math.abs(iw * Math.cos(rad)) + Math.abs(ih * Math.sin(rad))) * scale;
    const rh = (Math.abs(iw * Math.sin(rad)) + Math.abs(ih * Math.cos(rad))) * scale;
    const maxX = Math.max(0, (rw - peState.frameW) / 2);
    const maxY = Math.max(0, (rh - peState.frameH) / 2);
    peState.offsetX = Math.min(maxX, Math.max(-maxX, peState.offsetX));
    peState.offsetY = Math.min(maxY, Math.max(-maxY, peState.offsetY));
  }

  function openPhotoEditor(file, ratio, onDone) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      peState.img = img;
      peState.url = url;
      peState.rotation = 0;
      peState.zoom = 1;
      peState.offsetX = 0;
      peState.offsetY = 0;
      peState.onDone = onDone;

      const r = peRatioToNumber(ratio);
      let fw = 320, fh = 320 / r;
      if (fh > 420) { fh = 420; fw = fh * r; }
      peState.frameW = Math.round(fw);
      peState.frameH = Math.round(fh);

      const stage = el("pe-stage");
      stage.style.width = peState.frameW + "px";
      stage.style.height = peState.frameH + "px";
      const canvas = el("pe-canvas");
      canvas.width = peState.frameW;
      canvas.height = peState.frameH;

      peFitImageToFrame();
      el("pe-zoom").value = 100;
      peRedraw();
      el("photo-editor").hidden = false;
    };
    img.onerror = () => {
      toast(t("이미지를 불러오지 못했습니다"));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  function closePhotoEditor() {
    el("photo-editor").hidden = true;
    if (peState.url) URL.revokeObjectURL(peState.url);
    peState.img = null;
    peState.url = null;
    peState.onDone = null;
  }

  el("pe-cancel").addEventListener("click", () => closePhotoEditor());

  el("pe-rotate-left").addEventListener("click", () => {
    peState.rotation = (peState.rotation + 270) % 360;
    peState.offsetX = 0; peState.offsetY = 0;
    peFitImageToFrame();
    peRedraw();
  });
  el("pe-rotate-right").addEventListener("click", () => {
    peState.rotation = (peState.rotation + 90) % 360;
    peState.offsetX = 0; peState.offsetY = 0;
    peFitImageToFrame();
    peRedraw();
  });
  el("pe-zoom").addEventListener("input", () => {
    peState.zoom = Number(el("pe-zoom").value) / 100;
    peClampOffset();
    peRedraw();
  });

  (function setupPeDrag() {
    const stage = el("pe-stage");
    let dragging = false, startX = 0, startY = 0, startOffX = 0, startOffY = 0;
    const down = (x, y) => {
      dragging = true; startX = x; startY = y;
      startOffX = peState.offsetX; startOffY = peState.offsetY;
      stage.classList.add("is-dragging");
    };
    const move = (x, y) => {
      if (!dragging) return;
      peState.offsetX = startOffX + (x - startX);
      peState.offsetY = startOffY + (y - startY);
      peClampOffset();
      peRedraw();
    };
    const up = () => { dragging = false; stage.classList.remove("is-dragging"); };
    stage.addEventListener("mousedown", (e) => down(e.clientX, e.clientY));
    window.addEventListener("mousemove", (e) => move(e.clientX, e.clientY));
    window.addEventListener("mouseup", up);
    stage.addEventListener("touchstart", (e) => { const t = e.touches[0]; down(t.clientX, t.clientY); }, { passive: true });
    stage.addEventListener("touchmove", (e) => { const t = e.touches[0]; move(t.clientX, t.clientY); }, { passive: true });
    stage.addEventListener("touchend", up);
  })();

  el("pe-apply").addEventListener("click", () => {
    const outW = 1200;
    const outH = Math.round((outW * peState.frameH) / peState.frameW);
    const outputScale = outW / peState.frameW;
    const outCanvas = document.createElement("canvas");
    outCanvas.width = outW;
    outCanvas.height = outH;
    peDraw(outCanvas.getContext("2d"), outW, outH, outputScale);
    const onDone = peState.onDone;
    outCanvas.toBlob((blob) => {
      closePhotoEditor();
      if (blob) onDone(blob);
    }, "image/jpeg", 0.92);
  });
