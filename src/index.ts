import "dotenv/config";
import { PrismaClient } from "./generated/prisma/client";
import { fetchListings } from "./services/ecommerce";
import { filterListings } from "./services/filter";
import { runIdentification, runValuation } from "./services/evaluate";
import { runScan } from "./scan";
import type { ScanConfig } from "./types";

const config: ScanConfig = {
  platform: "ebay",
  maxListings: 30,
  minMargin: 0,      // scoring handles quality gate now
  minConfidence: 0,
};

const prisma = new PrismaClient();

runScan(config, {
  prisma,
  fetchListings,
  filterListings,
  runIdentification,
  runValuation,
})
  .catch(console.error)
  .finally(() => prisma.$disconnect());
