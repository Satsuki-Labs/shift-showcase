import { run } from './command.mjs';

process.exitCode = await run(process.argv.slice(2));
