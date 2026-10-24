export class FinalAnswerEvidence {
  start(runId:string,manager:any):void;
  reset():void;
  observe(event:any):void;
  finish(manager:any):Record<string,any>|undefined;
}
