import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
/** Accidental-execution guard only; CLI selection is NOT user approval or an OS boundary. */
export function isExplicitOsAcceptanceEntry(url:string,argv:readonly string[],execArgv:readonly string[],testContext:string|undefined){
  return !testContext && !execArgv.some(arg=>arg==='--test'||arg.startsWith('--test=')) &&
    argv.length===3 && argv[2]==='--execute-os-acceptance' &&
    resolve(argv[1]??'')===fileURLToPath(url);
}
