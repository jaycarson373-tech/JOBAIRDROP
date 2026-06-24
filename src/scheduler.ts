import cron from "node-cron";
import { runEpoch } from "./epoch.js";

console.log("McJob airdrop worker started. Schedule: */5 * * * *");

cron.schedule("*/5 * * * *", () => {
  runEpoch();
});
