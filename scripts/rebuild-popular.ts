// Operator-only recovery after Redis data loss: `bun scripts/rebuild-popular.ts`
// Reads authoritative view shards from DynamoDB (Scan) and rewrites derived lg:popular / lg:meta in Redis.
import { rebuildPopularFromDynamo } from "../src/lib/backend.server";

rebuildPopularFromDynamo().then((n) => console.log(`Rebuilt popularity for ${n} titles`)).catch((e) => { console.error(e); process.exit(1); });
