// Synthetic browser smoke: no provider calls or production media.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/smoke-auto-trim.mjs
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1440,height:1050}});
page.on('pageerror',error=>console.error('Browser:',error.message));
try {
  await page.addInitScript(() => localStorage.setItem('scene-assembly-store',JSON.stringify({state:{videoEngine:'fal',falVideoModel:'kling-o1-edit',falApiKey:'local-smoke-placeholder'},version:0})));
  // A test-only module served by Playwright, never shipped with the application.
  const bundle = await readFile('node_modules/mediabunny/dist/bundles/mediabunny.mjs','utf8');
  await page.route('**/__smoke-mediabunny.mjs',route=>route.fulfill({contentType:'text/javascript',body:bundle}));
  await page.goto('http://localhost:3281/?workspace=video&videoMode=edit');
  await page.getByRole('radio',{name:'fal.ai',exact:true}).click();
  await page.getByRole('option',{name:/Kling O1 Edit/}).click();
  await page.getByLabel('Upload source video').waitFor({state:'attached'});
  const cachedFixture = await readFile('test-assets/auto-trim-source.mp4').catch(()=>null);
  const fixture = cachedFixture ? Array.from(cachedFixture) : await page.evaluate(async () => {
    const mb = await import('/__smoke-mediabunny.mjs');
    const canvas = document.createElement('canvas'); canvas.width=1280;canvas.height=720;
    const ctx=canvas.getContext('2d');
    const target=new mb.BufferTarget();
    const output=new mb.Output({format:new mb.Mp4OutputFormat(),target});
    const video=new mb.CanvasSource(canvas,{codec:'avc',bitrate:1_000_000});
    const audio=new mb.AudioBufferSource({codec:'aac',bitrate:96_000});
    output.addVideoTrack(video,{frameRate:24}); output.addAudioTrack(audio);
    await output.start();
    const sound=new AudioBuffer({numberOfChannels:1,length:48000*12,sampleRate:48000});
    const samples=sound.getChannelData(0);
    for(let i=0;i<samples.length;i++)samples[i]=Math.sin(i*2*Math.PI*440/48000)*0.1;
    await Promise.all([audio.add(sound).then(()=>audio.close()),(async()=>{
      for(let i=0;i<288;i++) {
        ctx.fillStyle='#0e191b';ctx.fillRect(0,0,1280,720);
        ctx.fillStyle='#00fff9';ctx.fillRect(60+i*3,350,100,100);
        ctx.font='42px sans-serif';ctx.fillText('Auto-trim test · 12 seconds with audio',70,200);
        await video.add(i/24,1/24);
      }
      video.close();
    })()]);
    await output.finalize();
    return Array.from(new Uint8Array(target.buffer));
  });
  await mkdir('test-assets',{recursive:true});
  await writeFile('test-assets/auto-trim-source.mp4',Buffer.from(fixture));
  await page.getByLabel('Upload source video').setInputFiles('test-assets/auto-trim-source.mp4');
  await page.getByText(/Trimmed to the first/).waitFor({timeout:45000}).catch(async error=>{console.error(await page.locator('body').innerText());throw error;});
  const notice=await page.getByText(/Trimmed to the first/).innerText();
  const result=await page.evaluate(async()=>{
    const video=document.querySelector('video');
    const blob=await fetch(video.src).then(r=>r.blob());
    const mb=await import('/__smoke-mediabunny.mjs');
    const input=new mb.Input({formats:mb.ALL_FORMATS,source:new mb.BlobSource(blob)});
    try {return {duration:await input.computeDuration(),hasAudio:!!await input.getPrimaryAudioTrack(),bytes:blob.size};}
    finally {input.dispose();}
  });
  if(result.duration>10.05||result.duration<9.8||!result.hasAudio)throw new Error(JSON.stringify(result));
  const section=page.getByRole('heading',{name:'Source video',exact:true}).locator('..').locator('..');
  await section.screenshot({path:'test-assets/auto-trim-source.png'});
  console.log(JSON.stringify({path:'device',notice,...result}));
  const origin='http://localhost:3281';
  const headers={Origin:origin};
  const login=await page.request.post(`${origin}/api/account/local-sign-in`,{headers});
  if(!login.ok())throw new Error('Local sign-in failed');
  const connection=await page.request.post(`${origin}/api/account/connections`,{headers,data:{provider:'fal',apiKey:'local-smoke-placeholder'}});
  if(!connection.ok())throw new Error('Local fixture connection failed');
  const begin=await page.request.post(`${origin}/api/account/imports`,{headers,data:{clientImportId:'auto-trim-smoke-'+createHash('sha256').update(Buffer.from(fixture)).digest('hex').slice(0,16),bytes:fixture.length,mimeType:'video/mp4',metadata:{provider:'local-test',modelId:'local-fixture',mediaType:'video',inputMode:'edit',prompt:'Auto-trim test · 12 seconds with audio',values:{},referenceIds:[]}}});
  let imported=await begin.json();
  if(!begin.ok())throw new Error(JSON.stringify(imported));
  if(imported.state!=='completed') {
    const transfer=await page.request.put(imported.url,{headers:{...headers,'Content-Type':'video/mp4'},data:Buffer.from(fixture)});
    imported=await transfer.json();
    if(!transfer.ok()||imported.state!=='completed')throw new Error(JSON.stringify(imported));
  }
  await page.reload();
  await page.getByRole('radio',{name:'fal.ai',exact:true}).click();
  await page.getByRole('option',{name:/Kling O1 Edit/}).click();
  await page.getByRole('button',{name:'From library',exact:true}).first().click();
  await page.getByRole('button',{name:'Use video',exact:true}).first().click();
  await page.getByText(/Trimmed to the first/).waitFor({timeout:45000});
  const original=await page.request.get(`${origin}/api/account/assets/${imported.assetId}/content`);
  const originalBytes=await original.body();
  if(!originalBytes.equals(Buffer.from(fixture)))throw new Error('Library original changed');
  console.log(JSON.stringify({path:'cloud library',notice:await page.getByText(/Trimmed to the first/).innerText(),originalBytes:originalBytes.length}));
} finally {await browser.close();}
