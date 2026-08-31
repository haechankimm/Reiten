/* ---------- 상품 색상 팔레트 (product_colors 테이블, 마이그레이션 010) ----------
   돈·재고를 건드리지 않는 순수 CRUD라 server.js 본체에서 분리했다. 다만 getValidColorMap()은
   상품 저장 검증(server.js의 상품 라우트)에서도 써야 해서 lib/colors.js에 따로 뒀다 —
   이 라우트 파일과 server.js가 같은 함수를 그대로 나눠 쓴다(복붙 아님). */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin } = require("../lib/auth");
const { logAdminAction } = require("../lib/adminLog");
const { toColorDto, getPublicColors } = require("../lib/colors");

const router = express.Router();

router.get("/api/colors", async (req, res) => {
  res.json(await getPublicColors());
});

router.get("/api/admin/colors", requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("product_colors").select("*").order("sort_order", { ascending: true });
  if (error) return res.status(500).json({ error: "색상 목록을 불러오지 못했습니다." });
  res.json(data.map(toColorDto));
});

function slugifyColorKey(label) {
  const base = String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "color";
}

/* 한글 라벨은 슬러그가 비거나("color"로만 남거나) 겹치기 쉬워서, DB에 이미 있는 key와
   충돌하면 -2, -3 ...을 붙여 유일한 값을 찾을 때까지 반복한다. */
async function uniqueColorKey(label) {
  const base = slugifyColorKey(label);
  let key = base;
  let suffix = 2;
  for (;;) {
    const { data, error } = await supabaseAdmin.from("product_colors").select("key").eq("key", key).maybeSingle();
    if (error) throw error;
    if (!data) return key;
    key = `${base}-${suffix++}`;
  }
}

const HEX_RE = /^#[0-9a-f]{6}$/i;

router.post("/api/admin/colors", requireAdmin, async (req, res) => {
  const { label, labelDe, hex } = req.body || {};
  const labelStr = String(label || "").trim().slice(0, 40);
  if (!labelStr) return res.status(400).json({ error: "색상 이름을 입력해 주세요." });
  const hexStr = String(hex || "").trim();
  if (!HEX_RE.test(hexStr)) return res.status(400).json({ error: "색상 값은 #RRGGBB 형식으로 입력해 주세요." });

  let key;
  try {
    key = await uniqueColorKey(labelStr);
  } catch (e) {
    console.error("[admin/colors] key 생성 실패:", e.message);
    return res.status(500).json({ error: "생성에 실패했습니다." });
  }

  const { count } = await supabaseAdmin.from("product_colors").select("key", { count: "exact", head: true });

  const { data, error } = await supabaseAdmin
    .from("product_colors")
    .insert({
      key,
      label: labelStr,
      label_de: labelDe ? String(labelDe).trim().slice(0, 40) : null,
      hex: hexStr,
      sort_order: count ?? 0,
    })
    .select()
    .single();

  if (error) {
    console.error("[admin/colors] 생성 실패:", error.message);
    return res.status(500).json({ error: "생성에 실패했습니다." });
  }
  logAdminAction(req, "color.create", "color", data.key, { label: data.label });
  res.json(toColorDto(data));
});

router.patch("/api/admin/colors/:key", requireAdmin, async (req, res) => {
  const { label, labelDe, hex } = req.body || {};
  const patch = { updated_at: new Date().toISOString() };
  if (label !== undefined) {
    const v = String(label || "").trim().slice(0, 40);
    if (!v) return res.status(400).json({ error: "색상 이름을 입력해 주세요." });
    patch.label = v;
  }
  if (labelDe !== undefined) patch.label_de = labelDe ? String(labelDe).trim().slice(0, 40) : null;
  if (hex !== undefined) {
    const v = String(hex || "").trim();
    if (!HEX_RE.test(v)) return res.status(400).json({ error: "색상 값은 #RRGGBB 형식으로 입력해 주세요." });
    patch.hex = v;
  }

  const { data, error } = await supabaseAdmin.from("product_colors").update(patch).eq("key", req.params.key).select().maybeSingle();
  if (error) {
    console.error("[admin/colors] 수정 실패:", error.message);
    return res.status(500).json({ error: "수정에 실패했습니다." });
  }
  if (!data) return res.status(404).json({ error: "존재하지 않는 색상입니다." });
  logAdminAction(req, "color.update", "color", req.params.key, patch);
  res.json(toColorDto(data));
});

/* 이미 어떤 활성 상품이 쓰고 있는 색상을 지우면 그 상품의 컬러 스와치가 깨지므로
   (COLORS[key]가 undefined가 됨), 삭제 전에 반드시 사용 여부를 먼저 확인한다. */
router.delete("/api/admin/colors/:key", requireAdmin, async (req, res) => {
  const key = req.params.key;
  /* supabase-js의 .contains(col, [값])은 값이 JS 배열이면 Postgres 배열 리터럴({값} 형태)로
     직렬화한다 — colors는 실제 Postgres 배열이 아니라 jsonb라서 그 형태를 그대로 받으면
     "invalid input syntax for type json"으로 매번 실패했다(예: "clay" 색상 삭제 시도 시 실제
     재현됨). jsonb 컬럼에서 포함 여부(@>)를 확인하려면 JSON 문자열 그대로 넘겨야 한다. */
  const { data: inUse, error: checkError } = await supabaseAdmin
    .from("products")
    .select("id")
    .eq("active", true)
    .filter("colors", "cs", JSON.stringify([key]));
  if (checkError) {
    console.error("[admin/colors] 사용 여부 확인 실패:", checkError.message);
    return res.status(500).json({ error: "삭제 가능 여부를 확인하지 못했습니다." });
  }
  if (inUse.length) {
    return res.status(409).json({ error: `이 색상을 사용 중인 상품이 ${inUse.length}개 있어 삭제할 수 없습니다.` });
  }

  const { error } = await supabaseAdmin.from("product_colors").delete().eq("key", key);
  if (error) {
    console.error("[admin/colors] 삭제 실패:", error.message);
    return res.status(500).json({ error: "삭제에 실패했습니다." });
  }
  logAdminAction(req, "color.delete", "color", key);
  res.json({ ok: true });
});

module.exports = router;
