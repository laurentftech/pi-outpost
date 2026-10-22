/** Windows running-app probe: installed shells, native clipboard and Ctrl+C, then rapid tab creation.
 * node scripts/probes/terminal-shells.mjs <widget URL>
 * Requires Windows PowerShell, pwsh, cmd and Git Bash on the server.
 */
import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({permissions:['clipboard-read','clipboard-write']});const page=await ctx.newPage();
const events=[];const sent=[];const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('websocket',ws=>{ws.on('framereceived',e=>{try{events.push(JSON.parse(String(e.payload)));}catch{}});ws.on('framesent',e=>{try{sent.push(JSON.parse(String(e.payload)));}catch{}});});
const wait=async(fn,label)=>{for(let i=0;i<150;i++){if(fn())return;await page.waitForTimeout(100);}throw Error('Timeout '+label);};
const data=id=>events.filter(e=>e.type==='terminal_data'&&e.terminalId===id).map(e=>e.data).join('');
const input=()=>page.locator('.xterm-helper-textarea:visible').last();
const command=async text=>{await input().focus();await page.keyboard.type(text);await page.keyboard.press('Enter');};
try{
await page.goto(process.argv[2] ?? 'http://127.0.0.1:4420/?server=http://127.0.0.1:4419');await page.getByRole('button',{name:/>_ terminal/i}).click();
await wait(()=>events.some(e=>e.type==='terminal_data'),'initial shell');
console.log('SHELLS',events.find(e=>e.type==='hello').terminal);
await command("Write-Output ('DEFAULT_' + $PSVersionTable.PSEdition)");await wait(()=>data('term-1').includes('DEFAULT_Desktop'),'PowerShell default');
await page.evaluate(()=>navigator.clipboard.writeText("Write-Output ('PASTE_' + 'CONFIRMED')"));await input().focus();await page.keyboard.press('Control+v');await page.keyboard.press('Enter');await wait(()=>data('term-1').includes('PASTE_CONFIRMED'),'CtrlV actual paste');
await page.evaluate(()=>navigator.clipboard.writeText("Write-Output ('SHIFT_' + 'PASTE')"));await input().focus();await page.keyboard.press('Control+Shift+v');await page.keyboard.press('Enter');await wait(()=>data('term-1').includes('SHIFT_PASTE'),'CtrlShiftV actual paste');
// Select the visible terminal buffer by dragging across the viewport.
const box=await page.locator('.xterm-screen:visible').boundingBox();await page.mouse.move(box.x+2,box.y+2);await page.mouse.down();await page.mouse.move(box.x+box.width-3,box.y+box.height-3,{steps:20});await page.mouse.up();await page.keyboard.press('Control+c');await page.waitForTimeout(250);const copied=await page.evaluate(()=>navigator.clipboard.readText());if(!copied.includes('PASTE_CONFIRMED'))throw Error('CtrlC did not copy output: '+copied);console.log('COPY_VERIFIED');
const cdp=await browser.newBrowserCDPSession();const {browserContextIds}=await cdp.send('Target.getBrowserContexts');const browserContextId=browserContextIds[0];
await ctx.clearPermissions();for(const allowWithoutSanitization of [false,true])await cdp.send('Browser.setPermission',{browserContextId,permission:{name:'clipboard-write',allowWithoutSanitization},setting:'denied',origin:new URL(page.url()).origin});console.log('STATE',await page.evaluate(async()=>(await navigator.permissions.query({name:'clipboard-write'})).state));
await page.keyboard.press('Control+c');await page.waitForTimeout(300);
await cdp.send('Browser.resetPermissions',{browserContextId});await ctx.grantPermissions(['clipboard-read','clipboard-write']);
await page.mouse.move(box.x+2,box.y+2);await page.mouse.down();await page.mouse.move(box.x+box.width-3,box.y+box.height-3,{steps:20});await page.mouse.up();await page.keyboard.press('Control+c');await page.waitForTimeout(250);
const refusal=await page.evaluate(()=>navigator.clipboard.readText());if(!refusal.includes('Clipboard copy was refused'))throw Error('Clipboard refusal was not reported: '+refusal);console.log('CLIPBOARD_REFUSAL_VERIFIED');
// Clicking in the terminal clears selection; Ctrl+C must now interrupt rather than copy.
await page.mouse.click(box.x+box.width/2,box.y+box.height-12);await command("Start-Sleep -Seconds 30; Write-Output 'UNINTERRUPTED_BAD'");await page.waitForTimeout(750);await page.keyboard.press('Control+c');await page.waitForTimeout(500);await command("Write-Output ('INTERRUPT_' + 'OK')");await wait(()=>data('term-1').includes('INTERRUPT_OK'),'CtrlC interrupts and shell survives');
const selector=page.getByRole('combobox',{name:'Shell for new terminal'});
await selector.selectOption('pwsh');await page.getByTitle('New Terminal Tab').click();await wait(()=>sent.filter(e=>e.type==='terminal_open').length>=2,'pwsh open');const pwshId=sent.filter(e=>e.type==='terminal_open').at(-1).terminalId;await wait(()=>data(pwshId).length>0,'pwsh prompt');await command("Write-Output ('PWSH_' + $PSVersionTable.PSEdition)");await wait(()=>data(pwshId).includes('PWSH_Core'),'PowerShell 7 execution');await selector.selectOption('cmd');await page.getByTitle('New Terminal Tab').click();await wait(()=>sent.filter(e=>e.type==='terminal_open').length>=3,'cmd open');const cmdId=sent.filter(e=>e.type==='terminal_open').at(-1).terminalId;await wait(()=>data(cmdId).length>0,'cmd prompt');await command('echo CMD_TEST_%COMSPEC%');await wait(()=>/CMD_TEST_.*cmd.exe/i.test(data(cmdId)),'cmd real execution');
await selector.selectOption('git-bash');await page.getByTitle('New Terminal Tab').click();await wait(()=>sent.filter(e=>e.type==='terminal_open').length>=4,'bash open');const bashId=sent.filter(e=>e.type==='terminal_open').at(-1).terminalId;await wait(()=>data(bashId).length>0,'bash prompt');await command("printf 'BASH_TEST_%s\\n' \"$BASH_VERSION\"");await wait(()=>/BASH_TEST_\d/.test(data(bashId)),'bash real execution');
await page.getByText('terminal 1',{exact:true}).click();await command("Write-Output ('ORIGINAL_' + 'ALIVE')");await wait(()=>data('term-1').includes('ORIGINAL_ALIVE'),'original shell preserved');
// Rapid creation and tab switching must not reuse a session identifier.
await selector.selectOption('powershell');await page.getByTitle('New Terminal Tab').dblclick();await page.waitForTimeout(1500);const opens=sent.filter(e=>e.type==='terminal_open');if(new Set(opens.map(e=>e.terminalId)).size!==opens.length)throw Error('Duplicate terminal ids');
console.log('PASS',JSON.stringify({shells:opens.map(e=>e.shellId??'default'),clipboard:copied.includes('PASTE_CONFIRMED'),errors}));if(errors.length)throw Error(errors.join('\n'));
await fs.writeFile('.tmp/terminal-browser-results.json',JSON.stringify({opens,events,errors},null,2));
}finally{await fs.writeFile('.tmp/terminal-browser-debug.json',JSON.stringify({sent,events,errors},null,2));await browser.close();}
