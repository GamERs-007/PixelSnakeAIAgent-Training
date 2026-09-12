const fs=require('node:fs');
const {chromium}=require('C:/Users/15165/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:1000}}), errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8766');
 await page.waitForFunction(()=>document.querySelector('#dqn-model').options.length>0);
 await page.selectOption('#dqn-model','best_model.pt');
 await page.evaluate(()=>{
   window.localDQN=SnakeDQN.BrowserDQNAgent;
   const reset=SnakeEngine.SnakeGame.prototype.reset,step=SnakeEngine.SnakeGame.prototype.step;
   SnakeEngine.SnakeGame.prototype.reset=function(){return reset.call(this,42)};
   SnakeEngine.SnakeGame.prototype.step=function(action){const before=this.getState().steps;const state=step.call(this,action);if(window.bench)window.bench.steps+=state.steps-before;return state};
 });
 const results=[];
 for(const execution of ['http','browser'])for(const assistance of [false,true])for(const speed of ['600','6000']){
   await page.selectOption('#agent-1','human');
   await page.evaluate(type=>{SnakeDQN.BrowserDQNAgent=type==='http'?SnakeLocalAI.RemoteAgent:window.localDQN},execution);
   await page.selectOption('#agent-1','dqn');await page.selectOption('#ai-speed',speed);
   await page.setChecked('#ai-safety',assistance);await page.check('#headless');await page.check('#auto-restart');
   await page.click('#start');await page.waitForTimeout(500);
   await page.evaluate(()=>{window.bench={steps:0,start:performance.now()}});
   await page.waitForTimeout(3000);
   const measured=await page.evaluate(()=>({...window.bench,elapsed:performance.now()-window.bench.start,ui:document.querySelector('#ai-rate-1').textContent,status:document.querySelector('#ai-status-1').textContent}));
   const row={execution,assistance,target:Number(speed),steps:measured.steps,seconds:measured.elapsed/1000,actual:measured.steps*1000/measured.elapsed,ui:measured.ui,status:measured.status};
   results.push(row); console.log(JSON.stringify(row));
   await page.click('#pause');
 }
 fs.writeFileSync('results/dqn-speed/benchmark.json',JSON.stringify({model:'best_model.pt',seed:42,headless:true,browser:'Edge (Playwright headless)',results,errors},null,2));
 if(errors.length)throw Error(errors.join('\n'));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
