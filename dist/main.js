#!/usr/bin/env node
import { createCli } from "./cli.js";
async function main() {
    const cli = createCli();
    await cli.parseAsync(process.argv);
}
main().catch((error) => {
    console.error("[Agent Smith] fatal error:");
    console.error(error);
    process.exit(1);
});
