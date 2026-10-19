"""Build editable SVG design-system and screen canvases from shared design tokens.

Run from any directory: python3 scripts/design/build_mindminer_design.py
Only Python's standard library is required.
"""
from pathlib import Path
from html import escape
import json
import math
import xml.etree.ElementTree as ET
import _wireframe_screens as wf

ROOT=Path(__file__).resolve().parents[2]
DEST=ROOT/'docs/design'
TOKENS=json.loads((DEST/'mindminer-design-tokens.json').read_text())
C=TOKENS['color']
INK=C['ivory']; MUTED=C['muted']; LINE=C['outline']; BG=C['floor']
PAPER=C['panel']; SOFT=C['panelRaised']; ACTIVE=C['amber']; ACCENT='#3A3530'; DANGER=C['danger']; TEAL=C['privateTeal']
raw=wf.raw; group=wf.group; end=wf.end

def polygon(points,fill,stroke=None,sw=1,extra=''):
    raw('<polygon points="'+' '.join(f'{x:.2f},{y:.2f}' for x,y in points)+f'" fill="{fill}"'+(f' stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"' if stroke else '')+f' {extra}/>')
def rect(x,y,w,h,fill=PAPER,stroke=None,rx=0,extra=''):
    raw(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{min(rx,2)}" fill="{fill}"'+(f' stroke="{stroke}"' if stroke else '')+f' {extra}/>')
def text(x,y,s,size=14,fill=INK,weight=400,anchor='start',mono=False):
    s=str(s)
    family='Menlo, Monaco, Courier New, monospace' if mono or s.isascii() else 'Pretendard, Apple SD Gothic Neo, sans-serif'
    raw(f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}">{escape(s)}</text>')
def line(x1,y1,x2,y2,stroke=LINE,sw=1,dash=None):
    raw(f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" stroke="{stroke}" stroke-width="{sw}" stroke-linecap="round"'+(f' stroke-dasharray="{dash}"' if dash else '')+'/>')
def circle(x,y,r,fill=PAPER,stroke=LINE,sw=1):
    raw(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>')
def ellipse(x,y,rx,ry,fill,stroke=None,sw=1):
    raw(f'<ellipse cx="{x}" cy="{y}" rx="{rx}" ry="{ry}" fill="{fill}"'+(f' stroke="{stroke}" stroke-width="{sw}"' if stroke else '')+'/>')
def panel(x,y,w,h,fill=PAPER,stroke=LINE,sw=2,cut=6):
    polygon([(x+cut,y),(x+w-cut,y),(x+w-cut,y+cut),(x+w,y+cut),(x+w,y+h-cut),(x+w-cut,y+h-cut),(x+w-cut,y+h),(x+cut,y+h),(x+cut,y+h-cut),(x,y+h-cut),(x,y+cut),(x+cut,y+cut)],fill,stroke,sw)
def cross(x,y,r=6,color=INK):line(x-r,y-r,x+r,y+r,color,2);line(x+r,y-r,x-r,y+r,color,2)
def check(x,y,color=TEAL):line(x-5,y,x-1,y+4,color,2);line(x-1,y+4,x+7,y-5,color,2)
def btn(x,y,w,label,primary=False,h=42,disabled=False,state='default'):
    fill=SOFT if disabled else C['amberHover'] if state=='hover' else C['amberPressed'] if state=='pressed' else ACTIVE if primary else PAPER
    border=LINE if disabled else INK if primary else C['rail']
    if state=='focus':panel(x-4,y-4,w+8,h+8,'none',INK,2,7)
    panel(x,y,w,h,fill,border,1.5,5)
    text(x+w/2,y+h/2+5,label,14,C['disabledText'] if disabled else C['coal'] if primary else INK,700,'middle')
def pill(x,y,label,w=108,active=False):
    panel(x,y,w,26,PAPER,TEAL if active else LINE,1,3);text(x+w/2,y+18,label,11,TEAL if active else MUTED,600,'middle')

def portrait(x,y,color,size=20):
    group('miner-portrait',x,y,size/20)
    polygon([(-15,19),(-12,3),(-6,-1),(7,-1),(13,4),(16,19)],'#35434A',C['coal'],2)
    polygon([(-8,-4),(-6,8),(0,12),(7,7),(9,-4)],'#AE9980')
    polygon([(-10,0),(10,0),(7,6),(-7,6)],C['coal'])
    raw(f'<path d="M-13 -4 Q-13 -21 0 -21 Q13 -21 13 -4 Z" fill="{color}" stroke="{C["coal"]}" stroke-width="2"/>')
    line(-15,-3,15,-3,C['coal'],4);line(-13,-4,13,-4,color,3)
    rect(3,-15,8,9,C['coal'],None,1);circle(7,-11,3,INK,C['coal'],1)
    line(-4,13,-9,18,C['coal'],2);line(4,13,9,18,C['coal'],2)
    end()
def avatar(x,y,name,active=False,r=18):
    panel(x-r-2,y-r-2,r*2+4,r*2+4,PAPER,ACTIVE if active else LINE,2 if active else 1,3)
    if name=='+':text(x,y+6,'+',20,MUTED,500,'middle');return
    idx=wf.NAMES.index(name) if name in wf.NAMES else 0
    portrait(x,y+1,TOKENS['playerColors'][idx],r*.82)
def coin(x,y,spent=False,r=7):
    circle(x,y,r,PAPER if spent else '#956C35',LINE if spent else ACTIVE,1.5)
    if not spent:circle(x,y,r-2,'none',C['amberHover'],.7)
def cart(x,y,s=1,color=None):
    group('miner-cart',x,y,s)
    ellipse(0,19,26,8,C['coal'])
    for xx in [-18,16]:circle(xx,17,6,C['coal'],LINE,2)
    polygon([(-24,-7),(-16,-16),(25,-13),(29,12),(19,20),(-22,15)],'#303D48',C['coal'],3)
    polygon([(-22,-5),(18,0),(18,20),(-22,15)],'#42515D',C['coal'],2)
    polygon([(18,0),(27,-9),(29,12),(18,20)],'#23323D',C['coal'],2)
    polygon([(-24,-7),(-16,-16),(25,-13),(18,0)],C['coal'],LINE,2)
    portrait(0,-13,color or TOKENS['playerColors'][0],.94*20)
    polygon([(-22,-5),(18,0),(18,6),(-22,1)],'#42515D',C['coal'],2)
    end()
def lamp(x,y,s=1):
    group('lamp',x,y,s);ellipse(0,12,23,10,'#3E3930')
    rect(-5,-18,10,22,C['coal'],LINE);rect(-3,-14,6,13,ACTIVE);line(-4,-20,4,-20,LINE,2);end()
def rail(a,b,dim=False,selected=False):
    x,y=a;x2,y2=b;dx=x2-x;dy=y2-y;length=math.hypot(dx,dy);nx=-dy/length;ny=dx/length
    for t in [.22,.5,.78]:
        xx=x+dx*t;yy=y+dy*t;line(xx-nx*8,yy-ny*8,xx+nx*8,yy+ny*8,C['coal'],6);line(xx-nx*7,yy-ny*7,xx+nx*7,yy+ny*7,C['timber'],4)
    for sign in [-1,1]:
        line(x+sign*nx*3,y+sign*ny*3,x2+sign*nx*3,y2+sign*ny*3,C['coal'],4)
        line(x+sign*nx*3,y+sign*ny*3,x2+sign*nx*3,y2+sign*ny*3,TEAL if selected else LINE if dim else C['rail'],1.8)
def junction(x,y,target=False,selected=False,goal=False):
    ellipse(x,y+3,12,8,C['coal']);ellipse(x,y,12,8,SOFT,C['rail'],1.5)
    if target or selected:
        ellipse(x,y,20,14,'none',TEAL if selected else INK,2)
        circle(x,y,2,TEAL if selected else INK,'none')
    if goal:rect(x-4,y-3,8,6,ACTIVE)
def cave(cx,top,step,unit):
    left=cx-4*unit-68;right=cx+4*unit+68;base=top+4*step
    polygon([(left+58,top-42),(right-58,top-42),(right,top+37),(right+10,base-18),(right-26,base+49),(left+26,base+49),(left-10,base-18),(left,top+37)],BG,C['coal'],3)
    for side in [-1,1]:
        xx=left if side==-1 else right
        for j in range(3):
            yy=top-20+j*110
            polygon([(xx-27,yy),(xx+22,yy-12),(xx+35,yy+37),(xx+15,yy+78),(xx-26,yy+66),(xx-39,yy+26)],C['rock'],C['coal'],3)
            polygon([(xx-27,yy),(xx+22,yy-12),(xx+12,yy+27),(xx-39,yy+26)],C['rockFace'])
        xx+=side*10
        polygon([(xx-5,top+54),(xx+4,top+54),(xx+4,base-14),(xx-5,base-14)],C['timber'],C['coal'],2)
        lamp(xx-side*12,top+108,1)
    panel(cx-20,top-39,40,38,C['coal'],C['timber'],3,3)
    rect(cx-11,top-28,22,26,'#493B2C');rect(cx-6,top-22,12,19,ACTIVE)

def board(cx=480,top=190,step=65,unit=64,mines=False,pawn=None,targets=False,pick=False,boom=False,selected=False,dim=False,invalid=False):
    cave(cx,top,step,unit)
    nodes={(r,c):(cx+(c-r/2)*unit*2,top+r*step) for r in range(5) for c in range(r+1)}
    for (r,c),a in nodes.items():
        for dest in ([(r,c+1)] if c<r else [])+([(r+1,c),(r+1,c+1)] if r<4 else []):
            b=nodes[dest];is_selected=selected and (r,c)==(2,1) and dest==(3,1)
            rail(a,b,dim,is_selected)
            if pick and r!=4:
                xx=(a[0]+b[0])/2;yy=(a[1]+b[1])/2;circle(xx,yy,5,PAPER,TEAL,1.5)
    mine_edges=[((0,0),(1,0)),((0,0),(1,1))] if invalid else [((1,0),(2,0)),((2,2),(3,2)),((3,1),(4,1)),((3,3),(4,3))]
    if mines:
        for a,b in mine_edges:
            p=nodes[a];q=nodes[b];xx=(p[0]+q[0])/2;yy=(p[1]+q[1])/2
            circle(xx,yy,9,PAPER,DANGER,2);cross(xx,yy,4,DANGER)
    for (r,c),(x,y) in nodes.items():
        legal=targets and (r==4 if pawn is None else (r,c) in [(2,0),(3,1),(4,0),(4,1)])
        junction(x,y,legal,False,r==0)
        if r==4:
            panel(x-13,y+18,26,23,PAPER,LINE,1,3);text(x,y+34,c+1,12,INK,700,'middle')
    if pawn:cart(*nodes[pawn],.8)
    if selected:
        p=nodes[(2,1)];q=nodes[(3,1)];xx=(p[0]+q[0])/2;yy=(p[1]+q[1])/2;circle(xx,yy,10,PAPER,TEAL,2);check(xx,yy,TEAL)
    if boom:
        p=nodes[(2,1)];q=nodes[(3,1)];xx=(p[0]+q[0])/2;yy=(p[1]+q[1])/2
        polygon([(xx+math.cos(i*math.pi/8)*(32 if i%2==0 else 18),yy+math.sin(i*math.pi/8)*(32 if i%2==0 else 18)) for i in range(16)],'#3E2C2B',DANGER,2)
        cross(xx,yy,10,DANGER)

def hud(phase='탐색',active=0,coins=3,roundn=2):
    rect(0,0,960,600,C['coal']);panel(14,12,932,43,PAPER,LINE,1.5,5)
    text(30,39,'MINDMINER',17,INK,700);text(480,39,f'{phase}   /   ROUND {roundn:02d} · 07',13,INK,600,'middle')
    text(928,39,'AB12CD    ?    나가기',11,MUTED,400,'end')
    for i,n in enumerate(wf.NAMES):
        x=159+i*109;panel(x,67,101,46,PAPER,ACTIVE if i==active else LINE,2 if i==active else 1,4)
        avatar(x+21,90,n,i==active,15);text(x+42,87,n,11,INK,600);text(x+42,103,f'{[4,2,0,3,1,0][i]} pt',10,MUTED)
    text(24,153,'내 힌트',11,MUTED,600)
    for i in range(3):coin(32+i*22,176,i>=coins)
    text(24,205,'남기면 승점',10,MUTED)
    text(936,153,'현재 순서',11,MUTED,600,'end')
    text(936,179,f'{wf.NAMES[active]} → {wf.NAMES[(active+1)%6]}' if active>=0 else '함께 준비 중',13,INK,600,'end')
    text(936,205,'로테이션 01',10,MUTED,400,'end')
def bottom(title,sub='',action='ヒント',showhint=True):
    panel(190,520,580,64,PAPER,C['rail'],1.5,6);text(210,545,title,15,INK,700)
    if sub:text(210,567,sub,10,MUTED)
    if showhint:btn(619,532,136,action if action!='ヒント' else '힌트 사용 −1',True,40)
def modal(x,y,w,h,title,closable=True):
    rect(0,0,960,600,C['canvas'],extra='opacity="0.76"')
    panel(x+5,y+6,w,h,C['canvas'],None,1,8);panel(x,y,w,h,PAPER,C['rail'],2,8)
    if title:line(x+20,y+60,x+w-20,y+60,LINE)
    text(x+28,y+41,title,22,INK,700)
    if closable:cross(x+w-27,y+30,5,MUTED)
def home():
    rect(0,0,960,600,C['coal']);panel(18,16,924,42,PAPER,LINE,1,5)
    text(35,43,'MINDMINER',16,INK,700);text(923,43,'플레이 방법  ?',12,MUTED,400,'end')
    group('title-cave',473,116,.76);board(cx=300,top=75,step=65,unit=58,pawn=(3,1));end()
    text(56,169,'기억으로 돌아가는 작은 갱도',13,MUTED)
    text(51,239,'MIND',63,INK,700,mono=True);text(51,301,'MINER',63,INK,700,mono=True)
    line(56,325,134,325,ACTIVE,3);text(56,357,'함께 보고, 각자 기억하세요.',15,MUTED)
    btn(56,395,279,'친구와 플레이   →',True,48);btn(56,457,279,'혼자 연습 · 봇 5명',False,43)
    text(56,546,'이전 방 AB12CD로 돌아가기  ↗',11,MUTED)
    text(924,566,'6명 / 7라운드 / 힌트 3개',11,MUTED,400,'end')

BASE_SCREEN=wf.screen
def screen(kind):
    if kind in ['invalid','ready']:
        hud('지뢰 배치',-1,3,2);text(480,142,'나의 갱도  ·  비공개',12,TEAL,600,'middle');board(mines=True,invalid=kind=='invalid')
        text(24,253,'배치 도구',11,MUTED,600);btn(24,269,128,'랜덤 배치',False,36,kind=='ready');btn(24,315,128,'전체 지우기',False,36,kind=='ready')
        text(936,255,'설치한 지뢰',11,MUTED,400,'end');text(936,291,'2개' if kind=='invalid' else '4개',27,INK,700,'end')
        if kind=='invalid':
            text(936,320,'안전 경로 없음',11,DANGER,600,'end');bottom('탈출 승강기까지 가는 길을 남겨주세요','지뢰를 눌러 제거하면 다시 준비할 수 있어요.',showhint=False);btn(619,532,136,'준비 완료',False,40,True)
        else:
            pill(382,469,'4 / 6명 준비 완료',196,True);bottom('배치를 마쳤어요','모두 준비하면 판을 왼쪽으로 전달합니다.',showhint=False)
        return
    if kind=='lobby':
        hud('대기실',-1,3,1);rect(0,60,960,540,C['coal'])
        text(480,105,'원정대를 기다리는 중',27,INK,700,'middle');text(480,133,'방 AB12CD    ·    5 / 6명 합류',13,MUTED,400,'middle')
        polygon([(318,234),(480,182),(642,234),(642,405),(480,457),(318,405)],BG,LINE,2)
        for i in range(6):
            a=i*math.pi/3-math.pi/2;line(480,320,480+110*math.cos(a),320+90*math.sin(a),C['timber'],3)
        panel(387,270,186,95,PAPER,C['rail'],1.5,5);text(480,302,'AB12CD',24,INK,700,'middle');btn(412,319,136,'초대 링크 복사',False,34)
        for i,(x,y) in enumerate([(480,192),(685,246),(685,395),(480,459),(275,395),(275,246)]):
            avatar(x,y,wf.NAMES[i] if i<5 else '+',i==0,23);text(x,y+43,('나 · 방장' if i==0 else wf.NAMES[i]) if i<5 else '빈 자리',13,INK,600,'middle')
        btn(350,540,260,'6명이 모이면 시작할 수 있어요',False,42,True);return
    BASE_SCREEN(kind)

def mobile(kind):
    rect(0,0,360,680,C['coal'],LINE,2);panel(10,10,340,36,PAPER,LINE,1,4)
    text(20,34,'MINDMINER',14,INK,700);text(339,34,'?  나가기',11,MUTED,400,'end')
    if kind=='home':
        group('mobile-title-world',-108,45,.6);board(top=120,unit=58,pawn=(3,1));end()
        text(180,354,'MINDMINER',30,INK,700,'middle');text(180,385,'함께 보고, 각자 기억하세요.',13,MUTED,400,'middle')
        btn(28,422,304,'친구와 플레이   →',True,48);btn(28,484,304,'혼자 연습',False,48)
        text(180,576,'이전 방 AB12CD로 돌아가기',12,MUTED,400,'middle');text(180,640,'6명 · 7라운드 · 힌트 3개',11,MUTED,400,'middle');return
    if kind=='lobby':
        text(180,101,'원정대를 기다리는 중',22,INK,700,'middle');text(180,132,'AB12CD   ·   5 / 6명',14,MUTED,400,'middle');btn(100,151,160,'초대 링크 복사',False,38)
        for i,n in enumerate(wf.NAMES):
            x=27+(i%3)*109;y=226+(i//3)*147;panel(x,y,88,126,PAPER,LINE,1,5);avatar(x+44,y+39,n if i<5 else '+',i==0,21)
            text(x+44,y+85,n if i<5 else '빈 자리',13,INK,600,'middle');text(x+44,y+107,'방장' if i==0 else '합류 완료' if i<5 else '대기',10,MUTED,400,'middle')
        btn(27,566,306,'6명이 모이면 시작',False,48,True);return
    text(180,78,'ROUND 02 / 07',12,MUTED,600,'middle')
    for i,n in enumerate(wf.NAMES):avatar(40+i*56,115,n,i==0,17)
    text(180,162,'내 차례 · 미로의 갱도',16,ACTIVE,700,'middle')
    group('mobile-play-world',-108,99,.6);board(cx=480,top=176,step=65,unit=58,pawn=(3,0),targets=True);end()
    panel(18,438,324,47,PAPER,LINE,1,4);text(34,467,'내 힌트',12,INK,600)
    for i in range(3):coin(111+i*21,462)
    text(326,467,'전달 01',11,MUTED,400,'end')
    text(180,523,'연결된 분기점으로 이동하세요.',16,INK,700,'middle');text(180,550,'이동과 폭발의 위치를 기억하세요.',12,MUTED,400,'middle');btn(18,581,324,'힌트 사용하기  −1',True,48)
    if kind=='hint':
        rect(0,0,360,680,C['canvas'],extra='opacity="0.8"');panel(18,191,324,335,PAPER,C['rail'],2,8)
        text(40,230,'당신만의 단서',20,INK,700);cross(316,216,5);text(180,276,'✓ 지뢰가 없어요',23,TEAL,700,'middle')
        group('mobile-private-world',45.6,260,.28);board(top=176,unit=58,selected=True);end()
        text(180,433,'닫으면 답변이 사라집니다.',12,MUTED,400,'middle');btn(40,457,280,'기억했어요 · 닫기',True,48)

for key,value in dict(rect=rect,text=text,line=line,circle=circle,btn=btn,pill=pill,cross=cross,avatar=avatar,hud=hud,board=board,bottom=bottom,modal=modal,home=home,mobile=mobile,INK=INK,MUTED=MUTED,LINE=LINE,BG=BG,PAPER=PAPER,SOFT=SOFT,ACCENT=ACCENT,ACTIVE=ACTIVE,DANGER=DANGER).items():setattr(wf,key,value)

def section(y,no,title,note):
    text(96,y,no,17,ACTIVE,700);text(151,y,title,27,INK,700);text(1120,y,note,16,MUTED)
def card(x,y,w,h,label,tag=''):
    panel(x,y,w,h,PAPER,LINE,1,8);text(x+25,y+39,label,18,INK,700)
    if tag:text(x+w-24,y+38,tag,11,MUTED,500,'end')
    line(x+24,y+57,x+w-24,y+57,LINE)

def design_system():
    text(96,78,'MINDMINER / QUIET MINE',40,INK,700,mono=True)
    text(96,125,'게임 디자인 시스템과 화면 적용',34,INK,700)
    text(96,164,'단순한 면 · 또렷한 선 · 어두운 갱도 · 절제된 광부',18,MUTED)
    text(2880,77,'DESIGN SYSTEM 0.1',20,ACTIVE,700)
    text(2880,113,'기준: CONCEPT 04 / 2026.10.19',15,MUTED)
    text(2880,147,'2D 세미 레트로 HUD + 탑뷰 3D의 형태를 옮긴 벡터 시안',15,MUTED)
    section(242,'A01','FOUNDATION','한 오브젝트당 기본 면과 그림자 면 두 가지. 질감 없이 선과 명도로 구분합니다.')
    y=280
    card(96,y,1008,445,'의미를 가진 색','COLOR')
    swatches=[('COAL','coal','프레임 / 배경'),('FLOOR','floor','게임 바닥'),('ROCK','rockFace','갱도 실루엣'),('IVORY','ivory','본문 / 이동 대상'),('AMBER','amber','내 차례 / 주요 행동'),('PRIVATE','privateTeal','개인 힌트'),('DANGER','danger','폭발 / 오류'),('RAIL','rail','기본 레일')]
    for i,(n,k,role) in enumerate(swatches):
        x=124+(i%4)*244;yy=y+82+(i//4)*160;rect(x,yy,217,64,C[k],LINE,2);text(x,yy+87,n,13,INK,700);text(x,yy+109,C[k],12,MUTED);text(x,yy+134,role,12,MUTED)
    card(1144,y,1008,445,'절제된 레트로 타이포그래피','TYPE')
    text(1174,y+119,'MINDMINER',48,INK,700,mono=True);text(1174,y+149,'DISPLAY 48 / Menlo Bold',13,MUTED)
    text(1174,y+206,'기억을 따라 움직이는 광부',28,INK,700);text(1174,y+236,'화면 제목 28 / Pretendard Bold',13,MUTED)
    text(1174,y+283,'현재 선택할 수 있는 분기점을 알려주세요.',16,INK,500);text(1174,y+313,'본문 16 / 줄 간격 1.5 · 라벨 12 / 숫자 24',13,MUTED)
    text(1174,y+369,'ROUND 02 / 07     HINT -1',24,ACTIVE,700);text(1174,y+405,'영문과 숫자는 고정폭 · 한글은 읽기 쉬운 고딕',13,MUTED)
    card(2192,y,1008,445,'간격 · 선 · 모서리','GEOMETRY')
    for i,n in enumerate([4,8,12,16,24,32,48]):
        xx=2224+i*131;rect(xx,y+95,n,56,ACTIVE);text(xx,y+179,n,17,INK,700)
    text(2224,y+217,'간격 4px 단위 / HUD 여백 16 / 화면 안전 여백 24',14,MUTED)
    for i,(width,label) in enumerate([(1,'보조선 1'),(2,'UI 외곽 2'),(3,'월드 윤곽 3')]):
        xx=2224+i*300;line(xx,y+261,xx+246,y+261,INK,width);text(xx,y+290,label,13,MUTED)
    panel(2224,y+329,240,70,PAPER,INK,2,6);text(2344,y+371,'6px 계단 모서리',14,INK,600,'middle')
    text(2493,y+354,'큰 둥근 카드 대신 얕은 절단면',14,MUTED);text(2493,y+382,'텍스처 · 유광 · 입체 UI 장식은 사용하지 않음',14,MUTED)
    card(3240,y,1008,445,'상태를 읽는 문법','SEMANTICS')
    examples=[(ACTIVE,'내 차례','프레임 + YOUR TURN'),(INK,'이동 가능','가는 링 + 중앙점'),(TEAL,'개인 정보','개인 힌트 라벨'),(DANGER,'위험 / 오류','폭발 모양 + 오류 문장')]
    for i,(col,title,note) in enumerate(examples):
        yy=y+102+i*75;ellipse(3291,yy,17,12,'none',col,2);circle(3291,yy,2,col,'none');text(3330,yy+5,title,17,col,700);text(3545,yy+5,note,14,MUTED)
    text(3272,y+419,'색에 더해 윤곽·기호·문구를 함께 사용',13,MUTED)

    section(797,'A02','COMPONENT LIBRARY','같은 버튼·초상화·HUD·입력창을 데스크톱과 모바일에서 공유합니다.')
    y=835
    card(96,y,1008,470,'버튼과 입력 상태','INTERACTION')
    for i,(label,state) in enumerate([('기본','default'),('호버','hover'),('누름','pressed'),('포커스','focus')]):
        x=126+i*240;text(x,y+99,label,12,MUTED);btn(x,y+118,212,'힌트 사용 −1',True,48,state=state)
    btn(126,y+205,212,'보조 행동',False,48);btn(366,y+205,212,'비활성',False,48,True)
    panel(126,y+299,440,54,C['coal'],C['rail'],1.5,5);text(143,y+332,'플레이어 이름',16,MUTED)
    panel(596,y+299,440,54,C['coal'],DANGER,2,5);text(613,y+332,'방 코드',16,INK);text(596,y+382,'6자리 코드를 확인해주세요.',13,DANGER)
    text(126,y+431,'터치 영역 최소 48px · 포커스 외곽 2px / 간격 3px',13,MUTED)
    card(1144,y,1008,470,'광부 초상화와 플레이어 슬롯','PLAYER')
    for i,n in enumerate(wf.NAMES):avatar(1211+i*166,y+129,n,i==0,34);text(1211+i*166,y+193,n,14,INK,600,'middle')
    panel(1176,y+241,944,76,PAPER,ACTIVE,2,6);avatar(1214,y+278,'나',True,23)
    text(1254,y+272,'나 · YOUR TURN',17,ACTIVE,700);text(1254,y+296,'누적 4 pt',13,MUTED);text(2089,y+288,'선택 가능한 분기점으로 이동',14,INK,500,'end')
    text(1176,y+365,'작은 헬멧 / 가려진 얼굴 / 단순한 작업복 실루엣',15,MUTED);text(1176,y+399,'차분한 장비 색으로 구별 · 장난감 비율과 실사 얼굴 생략',15,MUTED)
    card(2192,y,1008,470,'자원 · 정보 · 경고','HUD')
    text(2224,y+112,'내 힌트',15,INK,600)
    for i in range(3):coin(2357+i*38,y+106,i==2,12)
    text(2520,y+112,'2 / 3',17,INK,700)
    pill(2224,y+151,'나만 보는 단서',166,True);pill(2414,y+151,'입력 잠김',146)
    panel(2224,y+220,944,61,PAPER,DANGER,1.5,5);cross(2253,y+249,7,DANGER);text(2281,y+255,'안전 경로를 하나 이상 남겨주세요.',16,INK,600)
    panel(2224,y+312,944,61,PAPER,TEAL,1.5,5);check(2253,y+342,TEAL);text(2281,y+348,'초대 링크를 복사했어요.',16,INK,600)
    text(2224,y+430,'내 코인만 노출 · 힌트 답과 배치도는 본인에게만 표시',14,MUTED)
    card(3240,y,1008,470,'패널과 모달','OVERLAY')
    panel(3272,y+87,944,289,C['canvas'],LINE,1,5);panel(3412,y+111,664,237,PAPER,C['rail'],2,8)
    text(3440,y+154,'지금 하던 플레이를 이어갈까요?',22,INK,700);cross(4049,y+138,5,MUTED);line(3436,y+175,4052,y+175,LINE)
    text(3440,y+211,'짧은 제목 + 한 가지 결정 + 주요 행동',15,MUTED);btn(3440,y+266,285,'계속 플레이',True,48);btn(3740,y+266,308,'홈으로 이동',False,48)
    text(3272,y+430,'스크림 76% · 모달은 배경보다 한 단계 밝게 · 게임 상태 유지',14,MUTED)

    section(1377,'A03','WORLD + FEEDBACK','어두움은 큰 색면과 제한된 등불로 만듭니다. 선로의 숨은 정답은 색으로 구별하지 않습니다.')
    y=1415
    card(96,y,1008,592,'게임 월드: 갱도와 철도망','WORLD')
    group('system-world-board',-20,y+15,1);board(cx=620,top=157,step=65,unit=58,pawn=(3,0),targets=True);end()
    text(128,y+535,'1 · 2 · 3 · 4 · 5개의 분기점 / 총 15개 / 선로 30개',14,MUTED);text(128,y+563,'모두 같은 바닥 높이 · 북쪽의 탈출 승강기 · 밑변 출발역 5개',14,MUTED)
    card(1144,y,1008,592,'월드 에셋: 두 면과 한 윤곽','ASSET KIT')
    group('asset-cart-study',1333,y+214,3.3);cart(0,0);end();text(1333,y+321,'광부 + 수레',16,INK,600,'middle')
    group('asset-rail-study',1690,y+173,2.4);rail((-42,-18),(42,18));junction(0,0);end();text(1690,y+321,'선로 + 분기점',16,INK,600,'middle')
    lamp(1978,y+211,3);text(1978,y+321,'작은 등불',16,INK,600,'middle')
    text(1176,y+389,'광부: 헬멧 / 그림자 속 얼굴 / 작업복 / 작은 손',15,MUTED);text(1176,y+423,'수레: 사각 몸체 / 원형 바퀴 / 측면 한 가지 그림자',15,MUTED)
    text(1176,y+457,'바위: 큰 외곽 / 기본 면 + 그림자 면 / 최대 3px 윤곽',15,MUTED);text(1176,y+491,'레일: 두 줄 + 짧은 침목 / 질감과 반사 없이 일관된 폭',15,MUTED)
    card(2192,y,1008,592,'선택 · 배치 · 폭발 구분','STATE GRAMMAR')
    junction(2272,y+134,True);text(2327,y+139,'이동 가능: 밝은 링 + 중앙점',16,INK,600)
    circle(2272,y+219,15,PAPER,TEAL,2);check(2272,y+219,TEAL);text(2327,y+225,'힌트: 청록 선분 + 개인 모달',16,TEAL,600)
    circle(2272,y+305,15,PAPER,DANGER,2);cross(2272,y+305,6,DANGER);text(2327,y+310,'배치 지뢰: 소유자의 화면만 X',16,DANGER,600)
    polygon([(2272+math.cos(i*math.pi/8)*(24 if i%2==0 else 13),y+391+math.sin(i*math.pi/8)*(24 if i%2==0 else 13)) for i in range(16)],'#3E2C2B',DANGER,2)
    text(2327,y+397,'폭발: 한 번의 파열 모양 / 이후 지움',16,DANGER,600)
    text(2224,y+484,'일반 탐색에서는 모든 선로가 같은 모양입니다.',15,MUTED);text(2224,y+520,'힌트·폭발·이동 흔적이 다음 상태에 남지 않습니다.',15,MUTED)
    card(3240,y,1008,592,'반응형과 전환 시간','RHYTHM')
    panel(3272,y+90,566,232,C['coal'],LINE,1,4);rect(3292,y+108,526,27,PAPER,LINE);rect(3445,y+149,213,124,BG,LINE);rect(3402,y+285,300,21,PAPER,LINE)
    panel(3871,y+90,151,232,C['coal'],LINE,1,4);rect(3883,y+106,127,20,PAPER,LINE);rect(3883,y+139,127,121,BG,LINE);rect(3883,y+274,127,30,ACTIVE)
    text(3272,y+357,'데스크톱: 플레이어 상단 / 중앙 월드 / 하단 행동',14,MUTED);text(3272,y+387,'모바일: 같은 우선순위 / 선택 대상은 화면 좌표로 최소 48px',14,MUTED)
    text(3272,y+442,'이동 650ms  ·  폭발 1,800ms  ·  판 전달 1,400ms',15,INK,600)
    text(3272,y+478,'턴 시작 900ms는 새 연출 제안 · 시간 제한 없이 기존 규칙 유지',14,MUTED)
    text(3272,y+516,'모션 축소 시 위치 보간 생략 · 사건 공개 시간은 동일하게 유지',14,MUTED)
    panel(96,2050,4152,116,PAPER,LINE,1,6)
    text(126,2084,'ART DIRECTION RULE',13,ACTIVE,700)
    text(126,2117,'어둡지만 읽히는 갱도. 성숙하지만 단순한 광부. 평면 HUD와 얕은 입체 월드.',24,INK,700)
    text(126,2148,'실사 질감·잡다한 파편·금속 광택 없이 큰 색면, 절제된 등불, 깨끗한 선으로 구성합니다.',16,MUTED)

def flow_map(y):
    panel(96,y,4152,174,PAPER,LINE,1,6);text(122,y+34,'SCREEN FLOW / 24 FRAMES',14,ACTIVE,700)
    flow=[('H01–H03','홈 / 입장'),('L01','대기실'),('P01–P03','지뢰 배치'),('G01–G08','탐색 / 기억'),('R01','라운드 결과'),('R02','최종 결과')]
    for i,(a,b) in enumerate(flow):
        x=122+i*681;panel(x,y+52,608,57,SOFT,LINE,1,4);text(x+17,y+76,a,12,MUTED,700);text(x+17,y+99,b,17,INK,700)
        if i<5:line(x+620,y+80,x+657,y+80,ACTIVE,2);line(x+650,y+74,x+657,y+80,ACTIVE,2);line(x+650,y+86,x+657,y+80,ACTIVE,2)
    text(122,y+146,'전원 실패 → 판 전달 → 탐색   /   라운드 결과 → 다음 배치   /   최종 결과 → 새 게임',15,MUTED)
    text(2850,y+146,'데모: 홈 → 배치  ·  공통 모달: 규칙 / 나가기 / 힌트',14,MUTED)

def draw_screens():
    flow_map(2260)
    for ri,(num,title,desc,cards) in enumerate(wf.rows):
        ry=2515+ri*853;section(ry+25,num,title,desc)
        for ci,(sid,title,kind,note) in enumerate(cards):
            x=96+ci*1048;fy=ry+100;text(x,ry+74,sid,14,ACTIVE,700);text(x+65,ry+74,title,19,INK,700)
            panel(x-2,fy-2,1012,634,'none',LINE,1,2)
            group(f'{sid}-{kind}',x,fy,1.05);raw('<g clip-path="url(#viewport-desktop)">');screen(kind);end();end()
            text(x,fy+656,note,13,MUTED);text(x,fy+681,'QUIET MINE / SEMI-RETRO / CONCEPT 04',11,LINE,500)
    ry=2515+5*853;section(ry+25,'06','모바일 화면 방향','같은 디자인 토큰을 사용하고 보드·정보·행동 순서를 작은 화면에 맞춥니다.')
    for i,(sid,label,kind,note) in enumerate([('M01','모바일 / 타이틀','home','H01 대응 · 어두운 타이틀 월드 + 주요 메뉴'),('M02','모바일 / 대기실','lobby','L01 대응 · 광부 초상화와 3 × 2 좌석'),('M03','모바일 / 내 차례','game','G03 대응 · 광산 / 자원 / 행동의 수직 구성'),('M04','모바일 / 개인 힌트','hint','G06 대응 · 전체 맥락을 담은 개인 보드')]):
        x=96+i*1048;fy=ry+100;text(x,ry+74,sid,14,ACTIVE,700);text(x+65,ry+74,label,19,INK,700)
        panel(x,fy,1008,714,PAPER,LINE,1,5);group(f'{sid}-{kind}',x+315,fy,1.05);raw('<g clip-path="url(#viewport-mobile)">');mobile(kind);end();end();text(x,fy+744,note,13,MUTED)

def start(height,title):
    wf.parts.clear();wf.group_counts.clear()
    raw(f'<svg xmlns="http://www.w3.org/2000/svg" width="4344" height="{height}" viewBox="0 0 4344 {height}">')
    raw(f'<title>{title}</title><desc>Concept 04를 기반으로 만든 게임 디자인 시스템. 편집 가능한 독립 벡터와 텍스트. 외부 이미지와 심벌 참조 없음.</desc>')
    raw('<defs><clipPath id="viewport-desktop"><rect width="960" height="600"/></clipPath><clipPath id="viewport-mobile"><rect width="360" height="680"/></clipPath></defs>')
    rect(0,0,4344,height,C['canvas'])
def finish(path):
    raw('</svg>');svg='\n'.join(wf.parts);root=ET.fromstring(svg)
    ids=[el.get('id') for el in root.iter() if el.get('id')]
    if len(ids)!=len(set(ids)):raise ValueError('Duplicate group IDs')
    path.write_text(svg,encoding='utf-8');print(f'{path.relative_to(ROOT)}: {len(svg.encode()):,} bytes')

if __name__=='__main__':
    DEST.mkdir(parents=True,exist_ok=True)
    start(2270,'MindMiner / Quiet Mine — 게임 디자인 시스템');design_system()
    text(96,2230,'DESIGN SYSTEM 0.1 / CONCEPT 04 / 2026.10.19',13,MUTED);finish(DEST/'mindminer-design-system.svg')
    start(7880,'MindMiner / Quiet Mine — 디자인 시스템과 24개 화면 적용');design_system();draw_screens()
    line(96,7790,4248,7790,LINE);text(96,7824,'Figma 편집용 벡터 / 데스크톱 20 + 모바일 4 / 화면 ID와 상태 흐름 유지',14,MUTED)
    text(4248,7824,'색·선·글자·컴포넌트 규칙을 모든 화면에 적용한 디자인 초안',14,MUTED,400,'end');finish(DEST/'mindminer-designed-wireframes.svg')
