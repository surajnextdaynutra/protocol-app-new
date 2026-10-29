/* Deletes every per-clinic / per-physician earning override
   (earning_overrides), so all orders and Product Pricing pages fall back to
   each product's default physician / clinic commission.

   Dry run (lists only):  node tools/clear-earning-overrides.mjs
   Delete:                node tools/clear-earning-overrides.mjs --apply */
import fs from "node:fs";
import mongoose from "mongoose";

const env = fs.readFileSync(new URL("../.env", import.meta.url), "utf8");
const uri = process.env.MONGODB_URI || (env.match(/^MONGODB_URI=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, "");
if (!uri) { console.error("MONGODB_URI not found in .env"); process.exit(1); }

await mongoose.connect(uri);
const col = mongoose.connection.db.collection("earning_overrides");
const rows = await col.find({}).toArray();
console.log(`${rows.length} override(s):`);
for (const r of rows) console.log(`  practice ${r.practiceId}  ${r.productKey}  ${r.role} ${r.entityId}  $${r.amount}`);

if (process.argv.includes("--apply")) {
  const res = await col.deleteMany({});
  console.log(`Deleted ${res.deletedCount}.`);
} else {
  console.log("Dry run. Add --apply to delete.");
}
await mongoose.disconnect();
