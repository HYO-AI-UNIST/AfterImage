// Purpose-built raster families: plates, compact controls, round sockets and relics.
const palettes = {illuminator:'#ffbf52',guardian:'#53efc4',trapper:'#c280ff',thief:'#ec759c',shifter:'#ff7850',recorder:'#7cafff'};
export function buildGamePolish(sprite,shape){
  let seed=917;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(const [name,base] of [['texture-metal','#151b1e'],['texture-paper','#222a29'],['texture-velvet','#161321']])sprite(name,256,256,g=>{
    g.fillStyle=base;g.fillRect(0,0,256,256);
    for(let i=0;i<6500;i++){g.fillStyle=random()>.5?'#b7c5cc08':'#00000022';g.fillRect(random()*256,random()*256,random()*2+.3,.7);}
    g.strokeStyle='#bdc9d407';g.lineWidth=1;
    for(let i=0;i<256;i+=8){g.beginPath();g.moveTo(0,i);g.lineTo(256,i+22);g.stroke();}
    if(name==='texture-paper'){g.strokeStyle='#b4c7c514';for(let i=0;i<256;i+=24){g.beginPath();g.moveTo(i,0);g.lineTo(i,256);g.moveTo(0,i);g.lineTo(256,i);g.stroke();}}
  });
  for(const family of ['action','compact','socket','card'])for(const state of ['idle','hover','pressed','disabled'])for(const primary of family==='action'||family==='compact'?[false,true]:[false]){
    const w=family==='socket'?72:family==='card'?180:family==='compact'?96:256,h=family==='socket'?72:family==='card'?224:56;
    sprite(`control-${family}${primary?'-primary':''}-${state}`,w,h,g=>{
      const hot=state==='hover',down=state==='pressed',off=state==='disabled',pad=family==='socket'?6:3;
      const gradient=g.createLinearGradient(0,0,0,h);
      gradient.addColorStop(0,off?'#232a2d':primary?hot?'#f4faff':down?'#7b9ba9':'#d4e4e9':hot?'#3c535c':down?'#142025':'#2b393f');
      gradient.addColorStop(1,off?'#151a1c':primary?'#829eac':'#121b20');
      if(family==='socket'){
        g.beginPath();g.arc(w/2,h/2,w/2-pad,0,Math.PI*2);g.fillStyle=gradient;g.fill();g.strokeStyle=off?'#394247':hot?'#d7f5ff':'#637a85';g.lineWidth=2;g.stroke();
        g.beginPath();g.arc(w/2,h/2,w/2-pad-5,0,Math.PI*2);g.strokeStyle='#9ab8c32a';g.stroke();
      }else{
        shape(g,pad,pad,w-pad*2,h-pad*2,gradient,off?'#354045':hot?'#c9e8f6':primary?'#d7eaf3':'#637a85',family==='card'?9:4,1.5);
        g.strokeStyle=primary?'#ffffff70':'#b5d4df26';g.beginPath();g.moveTo(12,7);g.lineTo(w-12,7);g.stroke();
        g.fillStyle='#00000044';g.fillRect(10,h-8,w-20,2);
      }
      if(family==='card'){g.strokeStyle='#6c899622';for(let y=32;y<h-20;y+=24){g.beginPath();g.moveTo(15,y);g.lineTo(w-15,y);g.stroke();}}
    });
  }
  const symbol=(g,role,cx=96,cy=96,s=1)=>{
    g.save();g.translate(cx,cy);g.scale(s,s);g.strokeStyle=palettes[role];g.fillStyle=palettes[role];g.lineWidth=5;g.lineCap='round';g.lineJoin='round';
    if(role==='illuminator'){
      g.strokeRect(-20,-18,40,46);g.beginPath();g.arc(0,-21,15,Math.PI,0);g.stroke();g.fillRect(-6,-7,12,24);
      for(let i=0;i<8;i++){const a=i*Math.PI/4;g.beginPath();g.moveTo(Math.cos(a)*39,Math.sin(a)*39);g.lineTo(Math.cos(a)*47,Math.sin(a)*47);g.stroke();}
    }else if(role==='guardian'){
      g.beginPath();g.moveTo(0,-38);g.lineTo(32,-25);g.lineTo(25,12);g.quadraticCurveTo(18,31,0,40);g.quadraticCurveTo(-18,31,-25,12);g.lineTo(-32,-25);g.closePath();g.stroke();
      g.beginPath();g.moveTo(-12,0);g.lineTo(-2,11);g.lineTo(17,-12);g.stroke();
      g.lineWidth=2;for(const side of [-1,1])for(let i=0;i<3;i++){g.beginPath();g.moveTo(side*37,-8+i*12);g.lineTo(side*(57-i*5),-22+i*9);g.stroke();}
    }else if(role==='trapper'){
      g.beginPath();g.moveTo(-40,-17);g.quadraticCurveTo(0,-39,40,-17);g.lineTo(28,23);g.lineTo(0,38);g.lineTo(-28,23);g.closePath();g.stroke();
      g.beginPath();g.moveTo(-26,-7);g.lineTo(-9,-1);g.moveTo(26,-7);g.lineTo(9,-1);g.stroke();g.beginPath();g.moveTo(-10,19);g.lineTo(10,19);g.stroke();
    }else if(role==='thief'){
      g.beginPath();g.moveTo(-43,0);g.quadraticCurveTo(0,-43,43,0);g.quadraticCurveTo(0,43,-43,0);g.stroke();g.beginPath();g.arc(0,0,14,0,Math.PI*2);g.stroke();g.fillRect(-3,-8,6,16);
    }else if(role==='shifter'){
      g.beginPath();g.moveTo(-34,-20);g.lineTo(32,-20);g.lineTo(17,-35);g.moveTo(32,-20);g.lineTo(17,-5);g.moveTo(34,20);g.lineTo(-32,20);g.lineTo(-17,5);g.moveTo(-32,20);g.lineTo(-17,35);g.stroke();
    }else{
      g.strokeRect(-26,-34,53,68);g.lineWidth=3;for(let i=0;i<3;i++){g.beginPath();g.moveTo(-37,-23+i*23);g.lineTo(-20,-23+i*23);g.moveTo(-9,-18+i*18);g.lineTo(17,-18+i*18);g.stroke();}
    }
    g.restore();
  };
  for(const role of Object.keys(palettes)){
    sprite(`role-${role}`,192,192,g=>{
      const c=palettes[role],grad=g.createRadialGradient(96,96,14,96,96,89);grad.addColorStop(0,c+'38');grad.addColorStop(.6,c+'14');grad.addColorStop(1,c+'00');g.fillStyle=grad;g.fillRect(0,0,192,192);
      g.strokeStyle=c+'60';g.lineWidth=1;g.beginPath();g.arc(96,96,65,0,Math.PI*2);g.stroke();g.beginPath();g.arc(96,96,57,.1,4.5);g.stroke();
      g.shadowColor=c;g.shadowBlur=15;symbol(g,role);g.shadowBlur=0;symbol(g,role);
      for(let i=0;i<12;i++){const a=i*2.4,r=68+(i%3)*6;g.fillStyle=c+(i%2?'cc':'66');g.fillRect(95+Math.cos(a)*r,95+Math.sin(a)*r,2,2);}
    });
    sprite(`sigil-${role}`,256,256,g=>{g.translate(128,128);g.strokeStyle=palettes[role]+'26';g.lineWidth=1;for(const r of [76,87,109]){g.beginPath();g.arc(0,0,r,0,Math.PI*2);g.stroke();}for(let i=0;i<12;i++){g.rotate(Math.PI/6);g.strokeRect(-4,-116,8,12);}g.translate(-128,-128);symbol(g,role,128,128,1.6);});
  }
  sprite('notebook',96,96,g=>{g.fillStyle='#253e4d';shape(g,19,13,60,71,'#203845','#8cbed9',5,2);g.fillStyle='#c7e2ef';for(let i=0;i<4;i++){g.fillRect(30,28+i*12,34,3);g.fillRect(13,23+i*16,14,4);}g.fillStyle='#6aa6e7';g.fillRect(65,15,5,29);});
  sprite('lens',128,128,g=>{g.shadowColor='#76d5fb';g.shadowBlur=14;g.strokeStyle='#d6eafa';g.lineWidth=9;g.beginPath();g.arc(54,51,31,0,Math.PI*2);g.stroke();g.shadowBlur=0;g.strokeStyle='#658c9e';g.lineWidth=15;g.beginPath();g.moveTo(78,77);g.lineTo(109,108);g.stroke();g.strokeStyle='#e2f6ff';g.lineWidth=4;g.beginPath();g.arc(54,51,23,3.6,4.7);g.stroke();});
  sprite('hint-charge',96,96,g=>{g.shadowColor='#ffc566';g.shadowBlur=10;g.fillStyle='#eaa94b';g.beginPath();g.moveTo(48,10);g.lineTo(67,38);g.lineTo(60,70);g.lineTo(48,84);g.lineTo(36,70);g.lineTo(29,38);g.closePath();g.fill();g.shadowBlur=0;g.fillStyle='#ffe3a3';g.fillRect(43,28,10,37);});
  sprite('coin-victory',96,96,g=>{g.fillStyle='#795625';g.beginPath();g.ellipse(48,54,34,32,0,0,Math.PI*2);g.fill();g.fillStyle='#dfb65b';g.beginPath();g.arc(48,46,33,0,Math.PI*2);g.fill();g.strokeStyle='#ffe4a4';g.lineWidth=3;g.beginPath();g.arc(48,46,25,0,Math.PI*2);g.stroke();g.fillStyle='#725124';g.beginPath();g.moveTo(48,27);g.lineTo(63,58);g.lineTo(33,58);g.closePath();g.fill();});
  sprite('scan-ring',256,256,g=>{g.strokeStyle='#83d5ed';g.lineWidth=3;for(const r of [83,94]){g.beginPath();g.arc(128,128,r,0,Math.PI*2);g.stroke();}g.strokeStyle='#d6f8ff';g.lineWidth=2;for(let i=0;i<24;i++){const a=i*Math.PI/12;g.beginPath();g.moveTo(128+Math.cos(a)*94,128+Math.sin(a)*94);g.lineTo(128+Math.cos(a)*103,128+Math.sin(a)*103);g.stroke();}});
}
