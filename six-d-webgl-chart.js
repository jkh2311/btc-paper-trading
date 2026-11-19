/* Hanine v255: real WebGL geometry for the opt-in 6D chart mode.
   This is VISUAL ONLY. It does not alter OHLC, RMI, signals, or orders.
   The six visible channels are time, price, volume, Bollinger volatility,
   existing RMI, and separately calculated historical scenarios. */
(()=>{
 'use strict';
 const canvas=document.createElement('canvas');
 let gl=null,program=null,buffer=null,loc=null,failed=false;
 let azimuth=24;
 const segments=12,PI2=Math.PI*2;
 const teal=[.10,.81,.72,1],red=[.98,.28,.40,1];
 function init(){
  if(failed)return false;
  if(gl)return true;
  try{
   gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:false,
    antialias:true,depth:true,stencil:false,preserveDrawingBuffer:true,
    powerPreference:'default'});
   if(!gl){failed=true;return false;}
   const vert=String.raw`
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec4 aColor;
uniform vec2 uCanvasSize;
uniform vec2 uPerspective;
varying vec3 vNormal;
varying vec4 vColor;
void main(){
 vec2 pixel=vec2(aPos.x+aPos.z*uPerspective.x,aPos.y-aPos.z*uPerspective.y);
 gl_Position=vec4(pixel.x/uCanvasSize.x*2.0-1.0,1.0-pixel.y/uCanvasSize.y*2.0,
  clamp(-aPos.z/160.0,-0.95,0.95),1.0);
 vNormal=aNormal;
 vColor=aColor;
}`;
   const frag=String.raw`
precision mediump float;
varying vec3 vNormal;
varying vec4 vColor;
void main(){
 vec3 light=normalize(vec3(-0.42,-0.38,0.85));
 float intensity=clamp(0.54+0.49*dot(normalize(vNormal),light),0.27,1.04);
 gl_FragColor=vec4(vColor.rgb*intensity,vColor.a);
}`;
   function compile(kind,source){
    const sh=gl.createShader(kind);gl.shaderSource(sh,source);gl.compileShader(sh);
    if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))
     throw Error('WebGL shader: '+gl.getShaderInfoLog(sh));
    return sh;
   }
   program=gl.createProgram();
   gl.attachShader(program,compile(gl.VERTEX_SHADER,vert));
   gl.attachShader(program,compile(gl.FRAGMENT_SHADER,frag));
   gl.linkProgram(program);
   if(!gl.getProgramParameter(program,gl.LINK_STATUS))
    throw Error('WebGL program: '+gl.getProgramInfoLog(program));
   buffer=gl.createBuffer();
   loc={pos:gl.getAttribLocation(program,'aPos'),
    normal:gl.getAttribLocation(program,'aNormal'),
    color:gl.getAttribLocation(program,'aColor'),
    viewport:gl.getUniformLocation(program,'uCanvasSize'),
    perspective:gl.getUniformLocation(program,'uPerspective')};
   canvas.addEventListener('webglcontextlost',event=>{
    event.preventDefault();gl=null;program=null;buffer=null;
    window.btcRedrawChart?.();
   });
   return true;
  }catch(err){
   console.warn('6D WebGL unavailable; preserving canvas fallback',err);
   gl=null;failed=true;return false;
  }
 }
 function render({data,bb,start,left,bw,y,plotW,w,h,top,priceBottom,
  volTop,volBottom,volumeMax}){
  if(!Array.isArray(data)||!data.length||bw<2.5||!init())return null;
  const dpr=Math.min(2,window.devicePixelRatio||1);
  const cw=Math.round(w*dpr),ch=Math.round(h*dpr);
  if(canvas.width!==cw||canvas.height!==ch){canvas.width=cw;canvas.height=ch;}
  const ribbon=[],solid=[];
  function vertex(list,p,n,col){
   list.push(p[0],p[1],p[2],n[0],n[1],n[2],col[0],col[1],col[2],col[3]);
  }
  function tri(list,a,b,c,n,col){
   vertex(list,a,n,col);vertex(list,b,n,col);vertex(list,c,n,col);
  }
  function quad(list,a,b,c,d,n,col){
   tri(list,a,b,c,n,col);tri(list,a,c,d,n,col);
  }
  // Actual 3D mesh strips for the observed Bollinger volatility envelope.
  // All four 3D corners derive from known historical upper/lower values.
  const ribbonColor=[.46,.34,.91,.13];
  const backColor=[.23,.56,.83,.10];
  for(let i=1;i<bb.length;i++){
   const p=bb[i-1],q=bb[i];
   if(!p||!q||![p.upper,p.lower,q.upper,q.lower].every(Number.isFinite))continue;
   const x0=(start+i-1-left+.5)*bw,x1=(start+i-left+.5)*bw;
   if(x1<0||x0>plotW)continue;
   const ua=[x0,y(p.upper),-9],ub=[x1,y(q.upper),-9];
   const la=[x0,y(p.lower),-9],lb=[x1,y(q.lower),-9];
   quad(ribbon,ua,ub,lb,la,[0,0,1],ribbonColor);
   const uba=[x0,y(p.upper),-25],ubb=[x1,y(q.upper),-25];
   const lba=[x0,y(p.lower),-25],lbb=[x1,y(q.lower),-25];
   quad(ribbon,uba,ubb,lbb,lba,[0,0,1],backColor);
   quad(ribbon,ua,ub,ubb,uba,[0,-.67,.74],[.49,.53,.94,.16]);
   quad(ribbon,la,lb,lbb,lba,[0,.67,.74],[.24,.7,.8,.11]);
  }
  // Cylinder caps and side surfaces are real mesh triangles with normals.
  function cylinder(cx,y0,y1,radius,zBase,color){
   if(![cx,y0,y1,radius,zBase].every(Number.isFinite))return;
   if(y1<y0)[y0,y1]=[y1,y0];
   const h=Math.max(.7,y1-y0),r=Math.max(.55,radius);
   const mid=(y0+y1)/2;
   for(let i=0;i<segments;i++){
    const a=i/segments*PI2,b=(i+1)/segments*PI2;
    const ax=Math.cos(a),az=Math.sin(a),bx=Math.cos(b),bz=Math.sin(b);
    const p=[cx+r*ax,y0,zBase+r*az],q=[cx+r*bx,y0,zBase+r*bz];
    const u=[cx+r*ax,y1,zBase+r*az],v=[cx+r*bx,y1,zBase+r*bz];
    const midNormal=[(ax+bx)/2,0,(az+bz)/2];
    quad(solid,p,q,v,u,midNormal,color);
    tri(solid,[cx,y0,zBase],q,p,[0,-1,0],
     [Math.min(1,color[0]*1.16),Math.min(1,color[1]*1.16),
      Math.min(1,color[2]*1.16),color[3]]);
    tri(solid,[cx,y1,zBase],u,v,[0,1,0],
     [color[0]*.70,color[1]*.70,color[2]*.70,color[3]]);
   }
  }
  const candles=Math.min(data.length,450);
  for(let i=0;i<candles;i++){
   const v=data[i],x=(start+i-left+.5)*bw;
   if(x < -bw||x > plotW+bw)continue;
   if(![v.o,v.h,v.l,v.c].every(Number.isFinite))continue;
   const up=v.c>=v.o,col=up?teal:red;
   const r=Math.max(.85,Math.min(bw*.295,8.8));
   const topY=Math.max(top,Math.min(priceBottom,y(Math.max(v.o,v.c))));
   const bottomY=Math.max(top,Math.min(priceBottom,y(Math.min(v.o,v.c))));
   if(y(v.h)<=priceBottom&&y(v.l)>=top){
    cylinder(x,Math.max(top,y(v.h)),Math.min(priceBottom,y(v.l)),
     Math.min(1.05,Math.max(.42,r*.20)),-.5,
     [col[0]*.82,col[1]*.82,col[2]*.82,1]);
   }
   if(bottomY>=topY)cylinder(x,topY,bottomY,r,0,col);
   const volume=Math.max(0,Number(v.v)||0);
   const volH=Math.min(volBottom-volTop,volume/Math.max(1,volumeMax)*(volBottom-volTop));
   if(volH>=.8)cylinder(x,volBottom-volH,volBottom,Math.max(.75,r*.76),0,
    up?[.14,.78,.66,.93]:[.9,.29,.41,.93]);
  }
  const ribbonVertices=ribbon.length/10;
  const combined=new Float32Array(ribbon.length+solid.length);
  combined.set(ribbon);combined.set(solid,ribbon.length);
  gl.viewport(0,0,cw,ch);gl.clearColor(0,0,0,0);
  gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  gl.bufferData(gl.ARRAY_BUFFER,combined,gl.DYNAMIC_DRAW);
  for(const [location,size,offset] of [[loc.pos,3,0],[loc.normal,3,12],[loc.color,4,24]]){
   if(location<0)continue;
   gl.enableVertexAttribArray(location);
   gl.vertexAttribPointer(location,size,gl.FLOAT,false,40,offset);
  }
  gl.uniform2f(loc.viewport,w,h);
  const tilt=azimuth*Math.PI/180;
  gl.uniform2f(loc.perspective,Math.sin(tilt)*.64,Math.cos(tilt)*.42);
  gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.CULL_FACE);gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  if(ribbonVertices)gl.drawArrays(gl.TRIANGLES,0,ribbonVertices);
  gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);
  gl.drawArrays(gl.TRIANGLES,ribbonVertices,solid.length/10);
  gl.flush();
  return canvas;
 }
 window.btc6DWebGL={render,available:()=>init(),getAngle:()=>azimuth,
  setAngle:value=>{
   const v=Number(value);if(!Number.isFinite(v))return;
   azimuth=Math.max(8,Math.min(60,v));window.btcRedrawChart?.();
  }};
})();
