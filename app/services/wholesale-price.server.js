import { connectDb } from "../db.server";
import { Product } from "../models/index.server";
import { defaultRepCommissionPerUnit, repForOrder } from "./commission.server";
import { tagVal } from "./ids.server";

/* Wholesale price = MFG COGS + Sales Commission.

   MFG COGS is the custom.mfg_cogs product metafield, entered in Shopify on
   the BASE product (rxbase:<key>); a practice copy (rxcopy:<key>) without its
   own value uses its base product's. Sales Commission is the $/unit of the
   rep assigned to the practice (or clinic) - their own rate, else the
   COMMISSION_PER_UNIT default ($1). No rep assigned = the default too.

   A product with no MFG COGS yet keeps its old custom.wholsale_price, so
   nothing changes until COGS is filled in. */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const hasNum = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));

/** $/unit sales commission for a practice / clinic: its rep's own rate, else
 *  the default. `ids` = { practiceId, clinicId, wsPracticeId, wsClinicId }. */
export async function salesCommissionFor(ids = {}) {
  const rep = await repForOrder(ids).catch(() => null);
  if (rep && rep.rate !== null && rep.rate !== undefined) return { rate: rep.rate, repId: rep.id };
  return { rate: await defaultRepCommissionPerUnit(), repId: rep ? rep.id : "" };
}

/** The base product's master key (rxbase:<key> on a product with no practice). */
function baseKeyOf(p) {
  return p.practiceId ? "" : tagVal(p.tags || [], "rxbase:");
}

/**
 * { productId: mfgCogs|null } for product docs ({productId, practiceId,
 * masterKey, tags, mfgCogs}). A copy without its own value takes its base
 * product's.
 */
export async function mfgCogsFor(products) {
  const out = {};
  const needBase = new Set();
  for (const p of products) {
    if (hasNum(p.mfgCogs)) out[p.productId] = Number(p.mfgCogs);
    else {
      out[p.productId] = null;
      if (p.masterKey) needBase.add(p.masterKey);
    }
  }
  if (needBase.size) {
    await connectDb();
    const bases = await Product.find(
      { practiceId: "", tags: { $in: [...needBase].map((k) => `rxbase:${k}`) } },
      { tags: 1, practiceId: 1, mfgCogs: 1 },
    ).lean();
    const byKey = {};
    for (const b of bases) {
      const k = baseKeyOf(b);
      if (k && hasNum(b.mfgCogs)) byKey[k] = Number(b.mfgCogs);
    }
    for (const p of products) {
      if (out[p.productId] === null && p.masterKey && byKey[p.masterKey] !== undefined) {
        out[p.productId] = byKey[p.masterKey];
      }
    }
  }
  return out;
}

/** MFG COGS + rate, or the old wholesale price when COGS is not set. */
export function wholesalePrice(mfgCogs, rate, fallback = 0) {
  return hasNum(mfgCogs) ? round2(Number(mfgCogs) + (Number(rate) || 0)) : round2(fallback);
}

/**
 * The wholesale page's prices for one caller: { rate, prices: {productId: $} }
 * for the given product ids (base products of the wholesale collection).
 */
export async function wholesalePricesFor(ids, productIds) {
  const { rate } = await salesCommissionFor(ids);
  const wanted = [...new Set((productIds || []).map((id) => String(id).replace(/\D/g, "")).filter(Boolean))].slice(0, 500);
  const prices = {};
  if (wanted.length) {
    await connectDb();
    const rows = await Product.find(
      { productId: { $in: wanted } },
      { productId: 1, practiceId: 1, masterKey: 1, tags: 1, mfgCogs: 1, wholesale: 1, variants: 1 },
    ).lean();
    const cogs = await mfgCogsFor(rows);
    for (const p of rows) {
      // only products with MFG COGS get a new price - the rest keep their own
      if (hasNum(cogs[p.productId])) prices[p.productId] = wholesalePrice(cogs[p.productId], rate);
    }
  }
  return { ok: true, rate: round2(rate), prices };
}
