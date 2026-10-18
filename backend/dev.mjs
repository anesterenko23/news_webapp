import { spawn, spawnSync } from 'node:child_process';
const compileArgs = ['node_modules/typescript/bin/tsc','-p','backend/tsconfig.json'];
if (spawnSync(process.execPath,compileArgs,{stdio:'inherit',windowsHide:true}).status !== 0) process.exit(1);
const compiler = spawn(process.execPath,[...compileArgs,'--watch','--preserveWatchOutput'],{stdio:'inherit',windowsHide:true});
const server = spawn(process.execPath,['--watch','backend/dist/server.js'],{stdio:'inherit',windowsHide:true});
const stop = () => { compiler.kill(); server.kill(); };
process.on('SIGINT',stop);process.on('SIGTERM',stop);
server.on('exit',code=>{compiler.kill();process.exit(code ?? 0);});
