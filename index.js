/**
 * Pella starts Node.js servers from a root JavaScript file. The checked-in
 * production bundle removes the need to compile TypeScript or install tooling
 * on Pella's constrained free tier.
 */
try {
  process.env.NODE_ENV ||= "production";
  await import("./pella-release/index.js");
} catch (error) {
  console.error("[Kronos Guard] Pella production bundle could not start", error);
  process.exitCode = 1;
}
