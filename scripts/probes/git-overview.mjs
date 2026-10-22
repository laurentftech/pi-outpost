import { execFileSync } from 'node:child_process';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { makeWorkspace, startServer } from '../../server/test/harness.mjs';
const lines=Array.from({length:2000},(_,i)=>`line ${i+1}`);lines[899]='wrapped '+ 'text '.repeat(180);
const baseline=lines.join('\n');const root=await realpath(await makeWorkspace({'overview.txt':baseline,'clean.txt':'Clean file'}));
const git=(...args)=>execFileSync('git',['-c','commit.gpgsign=false','-c','user.email=probe@example.com','-c','user.name=probe',...args],{cwd:root});git('init','-q');git('add','-A');git('commit','-qm','Initial');
const draft=[...lines];draft[4]='MODIFIED near start';draft.splice(1000,0,'ADDED middle');draft.pop();const disk=draft.join('\n');await writeFile(path.join(root,'overview.txt'),disk);
const server=await startServer(root,{server:{allowedOrigins:['http://127.0.0.1:4420']}},{env:{ANTHROPIC_API_KEY:'sk-ant-test-only-not-used'}});const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1117,height:956}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/CodeMirror plugin crashed/.test(m.text()))errors.push(m.text());});
const markers=()=>page.locator('.cm-git-overview button');const rail=()=>page.locator('.cm-git-overview');
try{
await page.goto('http://127.0.0.1:4420/?server='+encodeURIComponent(server.base));await page.getByRole('button',{name:/[◨◧]\s*files/}).click();await page.getByTitle('overview.txt',{exact:true}).click();await expect(markers()).toHaveCount(3);await expect(markers().nth(0)).toHaveAttribute('data-git-change','modified');await expect(markers().nth(1)).toHaveAttribute('data-git-change','added');await expect(markers().nth(2)).toHaveAttribute('data-git-change','deleted');
await expect.poll(async()=>markers().first().getAttribute('style')).toContain('top:');const boxes=await markers().evaluateAll(ms=>ms.map(m=>{const r=m.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,color:getComputedStyle(m).backgroundColor};}));const rb=await rail().boundingBox();if(!(boxes[0].top<boxes[1].top&&boxes[1].top<boxes[2].top&&boxes[2].bottom<=rb.y+rb.height+1&&boxes.every(b=>b.height>=3)))throw Error('marker geometry '+JSON.stringify({boxes,rb}));if(new Set(boxes.map(b=>b.color)).size!==3)throw Error('colors');
await page.getByTitle('clean.txt',{exact:true}).click();await expect(markers()).toHaveCount(0);await page.getByTitle('overview.txt',{exact:true}).click();await expect(markers()).toHaveCount(3);await page.getByRole('button',{name:'Close file viewer',exact:true}).click();await expect(rail()).toHaveCount(0);await page.getByTitle('overview.txt',{exact:true}).click();await expect(markers()).toHaveCount(3);
await markers().nth(1).click();await expect(page.locator('.cm-line').filter({hasText:'ADDED middle'})).toBeVisible();const scroller=page.locator('.cm-scroller');await expect.poll(()=>scroller.evaluate(el=>el.scrollTop)).toBeGreaterThan(500);const fixed=await rail().boundingBox();if(Math.abs(fixed.y-rb.y)>1)throw Error('rail scrolls with file');
await markers().nth(2).focus();await page.keyboard.press('Enter');await expect(page.locator('.cm-line').filter({hasText:'line 1999'})).toBeVisible();
// Native scroller remains separate and can scroll normally.
await scroller.evaluate(el=>el.scrollTop=0);await expect.poll(()=>scroller.evaluate(el=>el.scrollTop)).toBe(0);await expect(markers()).toHaveCount(3);
await markers().first().click();await page.locator('.cm-git-gutter [data-git-change="modified"]').click();await expect(page.getByRole('region',{name:'HEAD version of this change'})).toBeVisible();await page.setViewportSize({width:850,height:600});await expect(markers()).toHaveCount(3);await expect.poll(async()=>{const r=await rail().boundingBox();const s=await scroller.boundingBox();return Math.abs(r.height-s.height);}).toBeLessThan(2);await page.getByRole('button',{name:'Close',exact:true}).click();
await page.getByRole('button',{name:'✎ edit',exact:true}).click();await expect(page.getByTestId('file-editor')).toBeVisible();await markers().nth(1).click();await expect(page.locator('.cm-activeLine')).toContainText('ADDED middle');await page.keyboard.press('End');await page.keyboard.press('Enter');await page.keyboard.type('draft only');await expect(markers()).toHaveCount(3);await page.keyboard.press('Control+z');await expect(markers()).toHaveCount(3);if(await readFile(path.join(root,'overview.txt'),'utf8')!==disk)throw Error('navigation saved file');
await page.screenshot({path:'.tmp/git-overview-widget.png'});
console.log('PASS overview positions/colors, offscreen click and keyboard, source/editor, wrapped line/peek/resize, native scrolling and unsaved draft; workspace',root);
if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();await server.stop();}
