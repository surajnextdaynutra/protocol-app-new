/* Removes the MFG COGS and per-rep commission data that is no longer used:
     products.mfgCogs                  (mirrored custom.mfg_cogs)
     master_products.row["MFG COGS"]   (the master list column)
     sales_reps.commissionPerUnit      (every rep now earns COMMISSION_PER_UNIT)
   Orders already paid keep the commission frozen on them - not touched.

   Dry run (counts only):  node tools/clear-cogs-rep-rates.mjs
   Remove:                 node tools/clear-cogs-rep-rates.mjs --apply */
import fs from "node:fs";
import mongoose from "mongoose";

const env = fs.readFileSync(new URL("../.env", import.meta.url), "utf8");
const uri = process.env.MONGODB_URI || (env.match(/^MONGODB_URI=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, "");
if (!uri) { console.error("MONGODB_URI not found in .env"); process.exit(1); }

await mongoose.connect(uri);
const db = mongoose.connection.db;
const jobs = [
  { col: "products", field: "mfgCogs" },
  { col: "master_products", field: "row.MFG COGS" },
  { col: "sales_reps", field: "commissionPerUnit" },
];

for (const j of jobs) {
  const q = { [j.field]: { $exists: true } };
  const n = await db.collection(j.col).countDocuments(q);
  console.log(`${j.col}.${j.field}: ${n} document(s)`);
  if (j.col === "sales_reps" && n) {
    for (const r of await db.collection(j.col).find(q, { projection: { repId: 1, commissionPerUnit: 1 } }).toArray()) {
      console.log(`  ${r.repId}  ${r.commissionPerUnit === null ? "(default)" : "$" + r.commissionPerUnit}`);
    }
  }
  if (process.argv.includes("--apply") && n) {
    const res = await db.collection(j.col).updateMany(q, { $unset: { [j.field]: "" } });
    console.log(`  removed from ${res.modifiedCount}`);
  }
}
if (!process.argv.includes("--apply")) console.log("Dry run. Add --apply to remove.");
await mongoose.disconnect();
