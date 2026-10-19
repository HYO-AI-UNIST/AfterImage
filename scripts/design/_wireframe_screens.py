# Shared screen inventory and content from the first wireframe canvas.
from pathlib import Path
from html import escape
import math
import xml.etree.ElementTree as ET

INK='#26332F'; MUTED='#738078'; LINE='#CCD3CD'; BG='#F4F5EF'; PAPER='#FFFFFF'; SOFT='#ECEFE8'; ACCENT='#D6EAE0'; ACTIVE='#34745C'; DANGER='#8F5149'
parts=[]
group_counts={}
def raw(s): parts.append(s)
def rect(x,y,w,h,fill=PAPER,stroke=None,rx=0,extra=''):
    raw(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}"'+(f' stroke="{stroke}"' if stroke else '')+f' {extra}/>')
def text(x,y,s,size=14,fill=INK,weight=400,anchor='start'):
    raw(f'<text x="{x}" y="{y}" font-family="Pretendard, Apple SD Gothic Neo, sans-serif" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}">{escape(str(s))}</text>')
def line(x1,y1,x2,y2,stroke=LINE,sw=1,dash=None):
    raw(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{stroke}" stroke-width="{sw}" stroke-linecap="round"'+(f' stroke-dasharray="{dash}"' if dash else '')+'/>')
def circle(x,y,r,fill=PAPER,stroke=LINE,sw=1):
    raw(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>')
def group(name,x=0,y=0,scale=1):
    group_counts[name]=group_counts.get(name,0)+1
    unique=name if group_counts[name]==1 else f'{name}-{group_counts[name]}'
    raw(f'<g id="{unique}" transform="translate({x} {y}) scale({scale})">')
def end():raw('</g>')
def btn(x,y,w,label,primary=False,h=42,disabled=False):
    rect(x,y,w,h,SOFT if disabled else INK if primary else PAPER,LINE if not primary else None,7)
    text(x+w/2,y+h/2+5,label,14,MUTED if disabled else PAPER if primary else INK,600,'middle')
def pill(x,y,label,w=108,active=False):
    rect(x,y,w,26,ACCENT if active else SOFT,None,13);text(x+w/2,y+18,label,11,ACTIVE if active else MUTED,600,'middle')
def smalltitle(x,y,title,sub=''):
    text(x,y,title,18,INK,700)
    if sub:text(x,y+25,sub,12,MUTED)
def cross(x,y,r=6,color=INK):line(x-r,y-r,x+r,y+r,color,2);line(x+r,y-r,x-r,y+r,color,2)
def avatar(x,y,name,active=False,r=18):
    circle(x,y,r,ACCENT if active else SOFT,ACTIVE if active else LINE,2 if active else 1);text(x,y+5,name[0],13,ACTIVE if active else INK,600,'middle')
NAMES=['나','루나','테오','이든','노아','미로']
def hud(phase='탐색',active=0,coins=3,roundn=2):
    rect(0,0,960,600,BG)
    rect(0,0,960,54,PAPER);line(0,54,960,54)
    text(24,33,'△  MINDMINER',16,INK,800)
    text(480,33,f'{phase}   /   ROUND {roundn:02d} · 07',13,INK,600,'middle')
    text(938,33,'방 AB12CD     ?    나가기',12,MUTED,400,'end')
    for i,n in enumerate(NAMES):
        x=159+i*109
        rect(x,67,101,46,ACCENT if i==active else PAPER,ACTIVE if i==active else LINE,6)
        avatar(x+20,90,n,i==active,13);text(x+40,87,n,11,INK,600);text(x+40,103,f'{[4,2,0,3,1,0][i]} pt',10,MUTED)
    text(24,155,'내 자원',10,MUTED,600);text(24,180,f'힌트  ● {coins} / 3',14,INK,600)
    text(24,204,'남기면 승점에 포함',10,MUTED)
    text(936,155,'현재 순서',10,MUTED,600,'end');text(936,180,f'{NAMES[active]} → {NAMES[(active+1)%6]}',14,INK,600,'end')
    text(936,204,'로테이션 01',10,MUTED,400,'end')
def board(cx=480,top=176,step=65,unit=58,mines=False,pawn=None,targets=False,pick=False,boom=False,selected=False,dim=False):
    nodes={(r,c):(cx+(c-r/2)*unit*2,top+r*step) for r in range(5) for c in range(r+1)}
    raw(f'<path d="M{cx} {top} L{cx-4*unit} {top+4*step} L{cx+4*unit} {top+4*step} Z" fill="{SOFT}" stroke="{LINE}"/>')
    for (r,c),(x,y) in nodes.items():
        for dest in ([(r,c+1)] if c<r else [])+([(r+1,c),(r+1,c+1)] if r<4 else []):
            x2,y2=nodes[dest];line(x,y,x2,y2,LINE if dim else '#98A89D',2)
            if pick and r!=4:circle((x+x2)/2,(y+y2)/2,4,PAPER,ACTIVE)
    for r,c in [(1,0),(2,2),(3,1),(3,3)]:
        if mines:
            a=nodes[(r,c)];b=nodes[(r+1,c)];mx=(a[0]+b[0])/2;my=(a[1]+b[1])/2
            line(*a,*b,INK,3);circle(mx,my,9,PAPER,INK);cross(mx,my,3)
    for (r,c),(x,y) in nodes.items():
        if targets and (r==4 if pawn is None else (r,c) in [(2,0),(3,1),(4,0),(4,1)]):circle(x,y,15,ACCENT,ACTIVE)
        circle(x,y,8 if r==0 else 6,PAPER,INK,1.4)
        if r==4:text(x,y+28,str(c+1),11,MUTED,400,'middle')
    text(cx,top-23,'정상',11,MUTED,600,'middle')
    if selected:
        a=nodes[(2,1)];b=nodes[(3,1)];line(*a,*b,ACTIVE,5)
        circle((a[0]+b[0])/2,(a[1]+b[1])/2,11,ACCENT,ACTIVE)
        text((a[0]+b[0])/2,(a[1]+b[1])/2+4,'?',13,ACTIVE,700,'middle')
    if pawn:
        x,y=nodes[pawn];circle(x,y-13,9,INK,PAPER,2);rect(x-9,y-6,18,20,INK,PAPER,5)
    if boom:
        a=nodes[(2,1)];b=nodes[(3,1)];x=(a[0]+b[0])/2;y=(a[1]+b[1])/2
        circle(x,y,36,PAPER,DANGER,2);cross(x,y,15,DANGER)
        for i in range(8):
            a=i*math.pi/4;line(x+43*math.cos(a),y+43*math.sin(a),x+52*math.cos(a),y+52*math.sin(a),DANGER,2)
def bottom(title,sub='',action='ヒント',showhint=True):
    rect(190,505,580,72,PAPER,LINE,9);text(216,535,title,15,INK,700)
    if sub:text(216,556,sub,11,MUTED)
    if showhint:btn(614,521,137,action if action!='ヒント' else '힌트 사용 −1',False,40)
def modal(x,y,w,h,title,closable=True):
    rect(0,0,960,600,INK,extra='opacity="0.32"');rect(x,y,w,h,PAPER,INK,12)
    text(x+28,y+42,title,23,INK,700)
    if closable:cross(x+w-28,y+30)
def home():
    rect(0,0,960,600,BG)
    text(32,37,'△  MINDMINER',16,INK,800);text(925,37,'플레이 방법  ?',12,MUTED,400,'end')
    group('home-board',455,28,.83);board(cx=300,top=116,step=65,unit=58);end()
    text(62,172,'기억으로 길을 찾는 보드게임',14,MUTED)
    text(60,235,'MIND',65,INK,800);text(60,301,'MINER',65,INK,800)
    text(64,340,'함께 보고, 각자 기억하는 게임.',15,MUTED)
    btn(64,380,270,'친구와 플레이   →',True,50);btn(64,442,270,'혼자 연습 · 봇 5명',False,44)
    text(64,520,'이전 방 AB12CD로 돌아가기  ↗',12,MUTED)
    text(925,565,'6명  /  7라운드  /  힌트 3개',12,MUTED,400,'end')
def roster(x,y,host=True):
    for i,n in enumerate(NAMES):
        yy=y+i*37;avatar(x+16,yy,n,False,13);text(x+42,yy+4,n+(' · 방장' if i==0 else ''),12,INK,600)
        text(x+294,yy+4,f'{[4,2,0,3,1,0][i]} pt',12,MUTED,400,'end')
def screen(kind):
    if kind=='home':home()
    elif kind in ['create','join']:
        home();join=kind=='join';modal(250,105,460,399,'방 코드로 참가' if join else '친구와 플레이')
        text(278,178,'나를 부를 이름',12,MUTED);rect(278,191,404,44,BG,LINE,5);text(292,219,'플레이어 이름',14,MUTED)
        if join:
            text(278,265,'초대받은 6자리 코드',12,MUTED);rect(278,278,404,48,BG,LINE,5);text(480,310,'A B 1 2 C D',23,INK,600,'middle')
        else:
            rect(278,258,404,68,SOFT,None,5);text(298,286,'6명이 모이면 시작합니다.',14,INK,600);text(298,308,'초대 링크는 대기실에서 공유할 수 있어요.',12,MUTED)
        btn(278,351,404,'입장하기   →' if join else '새 방 만들기   →',True,46)
        text(480,447,'새 방 만들기' if join else '이미 초대받았나요?  코드로 참가',13,MUTED,400,'middle')
        text(480,478,'함께 플레이할 이름을 입력하세요.',10,MUTED,400,'middle')
    elif kind=='lobby':
        hud('대기실',-1,3,1);rect(0,58,960,155,BG);rect(0,138,960,462,BG)
        text(480,105,'원정대를 기다리는 중',27,INK,700,'middle');text(480,133,'방 AB12CD    ·    5 / 6명 합류',13,MUTED,400,'middle')
        circle(480,316,104,SOFT,LINE);text(480,305,'AB12CD',27,INK,700,'middle');btn(413,330,134,'초대 링크 복사',False,35)
        positions=[(480,192),(685,246),(685,395),(480,459),(275,395),(275,246)]
        for i,(x,y) in enumerate(positions):
            avatar(x,y,NAMES[i] if i<5 else '+',False,23);text(x,y+43,('나 · 방장' if i==0 else NAMES[i]) if i<5 else '빈 자리',13,INK,600,'middle')
        btn(350,535,260,'6명이 모이면 시작할 수 있어요',False,42,True)
    elif kind in ['place','invalid','ready']:
        ready=kind=='ready';invalid=kind=='invalid';hud('지뢰 배치',-1,3,2)
        text(480,145,'나의 판  ·  비공개',12,MUTED,600,'middle');board(mines=True)
        text(24,253,'배치 도구',11,MUTED,600);btn(24,269,128,'랜덤 배치',False,36,ready);btn(24,315,128,'전체 지우기',False,36,ready)
        text(936,255,'설치한 지뢰',11,MUTED,400,'end');text(936,291,'4개',27,INK,700,'end');text(936,320,'안전 경로 1개 이상',11,DANGER if invalid else MUTED,400,'end')
        if invalid:
            raw('<path d="M248 403 L712 403" stroke="#8F5149" stroke-width="5" stroke-dasharray="8 6"/>')
            bottom('정상까지 갈 수 있는 길을 남겨주세요','막힌 선분을 다시 눌러 지뢰를 제거하세요.','준비 완료',False);btn(614,521,137,'준비 완료',False,40,True)
        elif ready:
            modal(288,213,384,173,'✓  배치를 마쳤어요',False)
            text(480,294,'4 / 6명 준비 완료',15,INK,600,'middle');text(480,326,'모두 준비하면 판을 왼쪽으로 전달합니다.',12,MUTED,400,'middle')
            text(480,552,'기다리는 동안 내 배치를 볼 수 있어요.',12,MUTED,400,'middle')
        else:
            bottom('선분을 눌러 지뢰를 배치하세요','✓ 안전 경로가 남아 있어요.   ·   3 / 6명 준비','준비 완료',True)
    elif kind=='intro':
        hud('탐색',0);board(dim=True);modal(230,216,500,170,'',False)
        text(480,273,'YOUR TURN',17,ACTIVE,700,'middle');text(480,316,'내 차례입니다',35,INK,700,'middle');text(480,355,'미로의 판을 탐색합니다. 출발점을 선택하세요.',13,MUTED,400,'middle')
        text(480,554,'짧은 턴 시작 연출 후 보드 입력을 엽니다.',12,MUTED,400,'middle')
    elif kind in ['spawn','move','watch','pick','hint','explosion','rotation']:
        watching=kind=='watch';hud('탐색',1 if watching else 0,2 if kind=='hint' else 3)
        text(480,145,'테오의 판  ·  루나 탐색 중' if watching else '미로의 판  ·  나의 탐색',12,MUTED,600,'middle')
        board(pawn=(3,0) if kind in ['move','watch'] else None,targets=kind in ['spawn','move'],pick=kind=='pick',boom=kind=='explosion',selected=kind=='hint')
        if kind=='spawn':bottom('밑변에서 출발점을 고르세요','밝게 표시된 분기점을 선택할 수 있어요.')
        if kind=='move':bottom('연결된 점으로 이동하세요','앞·옆·뒤 어느 방향으로도 이동할 수 있어요.')
        if kind=='watch':bottom('루나가 탐색하고 있어요','이동과 폭발 위치를 기억하세요. 기록은 남지 않아요.',showhint=False)
        if kind=='pick':bottom('확인할 선분을 고르세요','코인 1개가 차감되고 답은 나에게만 보여요.','선택 취소')
        if kind=='hint':
            modal(258,81,444,438,'당신만의 단서')
            pill(286,154,'나만 보는 정보',122,True);text(480,213,'✓  지뢰가 없어요',26,INK,700,'middle')
            group('private-hint-full-board',312,187,.35);board(selected=True);end()
            text(480,387,'강조된 선분의 위치를 기억하세요.',13,MUTED,400,'middle')
            text(480,421,'닫으면 답이 사라져요. 다시 물으면 코인 −1',12,MUTED,400,'middle');btn(286,447,388,'기억했어요 · 닫기',True)
        if kind=='explosion':
            bottom('폭발! 이 위치를 기억하세요','잠시 후 루나의 차례로 넘어갑니다.',showhint=False);pill(791,230,'입력 잠김',145)
        if kind=='rotation':
            modal(237,215,486,186,'판을 왼쪽으로 전달합니다',False)
            text(480,301,'←   ←   ←',43,INK,600,'middle');text(480,341,'모두 실패했어요. 새로운 판으로 다시 도전합니다.',13,MUTED,400,'middle')
            text(480,371,'자신이 만든 판은 함께 건너뛰어요.',12,MUTED,400,'middle')
    elif kind in ['round','final']:
        final=kind=='final';hud('최종 결과' if final else '라운드 결과',-1,2,7 if final else 2)
        rect(0,59,960,159,BG);rect(0,140,960,460,BG)
        text(480,110,'MATCH COMPLETE' if final else 'ROUND CLEAR',13,ACTIVE,700,'middle')
        text(480,156,'나, 루나 · 공동 우승!' if final else '나, 정상에 도착!',31,INK,700,'middle')
        text(480,194,'7라운드의 기억이 모여 만든 결과' if final else '정상 도착 1점  +  남은 힌트 2개  =  +3점',14,MUTED,400,'middle')
        for i,n in enumerate(['나','루나','이든','노아','테오','미로']):
            y=224+i*40;rect(240,y,480,34,ACCENT if (i<2 if final else i==0) else PAPER,None,4)
            text(257,y+23,'=' if final and i==1 else f'0{i+1}',12,MUTED);text(305,y+23,n,13,INK,600);text(702,y+23,f'{[15,15,12,9,7,5][i] if final else [7,3,2,1,0,0][i]} pt',14,INK,700,'end')
        btn(240,492,480,'새 게임 시작   →' if final else '다음 라운드 배치하기   →',True,45)
        text(480,566,'방장만 진행 · 새 게임은 1라운드 배치부터' if final else '방장만 진행 · 다음 첫 차례는 승자의 왼쪽 사람',11,MUTED,400,'middle')
    elif kind=='rules':
        hud();board(dim=True);modal(203,62,554,477,'플레이 방법')
        for i,(a,b) in enumerate([('배치','안전한 길 하나를 남기고 지뢰를 설치하세요.'),('관찰','다른 사람의 이동과 폭발을 기억하세요.'),('탐색','밑변에서 출발해 연결된 점으로 이동하세요.'),('힌트','내 차례에 코인 1개로 선분 하나를 확인해요.'),('승리','먼저 정상에 도착하면 1 + 남은 코인만큼 득점해요.')]):
            y=152+i*62;circle(244,y-4,13,SOFT,LINE);text(244,y,str(i+1),11,INK,600,'middle');text(270,y,a,14,INK,700);text(270,y+23,b,12,MUTED)
        btn(231,481,498,'확인했어요',True,36)
    elif kind=='exit':
        hud();board(dim=True);modal(250,182,460,240,'홈으로 돌아갈까요?')
        text(278,259,'온라인 게임은 계속 진행되고 내 자리는 유지됩니다.',13,INK)
        text(278,287,'이 브라우저에서 이전 방으로 다시 연결할 수 있어요.',12,MUTED)
        btn(278,339,191,'계속 플레이');btn(481,339,201,'홈으로 이동',True)
    elif kind=='connection':
        hud();board(dim=True)
        rect(158,123,644,47,SOFT,INK,6);text(480,153,'◌  연결을 확인하고 있어요. 자동으로 다시 시도합니다.',14,INK,600,'middle')
        bottom('연결이 복구되면 계속할 수 있어요','현재 보드를 유지하고 조작을 잠급니다.',showhint=False)
        text(480,485,'세션 만료 시 홈으로 이동 + 참가 안내',11,MUTED,400,'middle')

def mobile(kind):
    w=360;h=680;rect(0,0,w,h,BG,LINE,18)
    text(20,33,'△ MINDMINER',14,INK,800);text(339,33,'?   나가기',11,MUTED,400,'end');line(0,50,360,50)
    if kind=='home':
        group('mobile-home-board',-102,9,.58);board(cx=480,top=176,step=65,unit=58);end()
        text(180,335,'MINDMINER',32,INK,800,'middle');text(180,368,'함께 보고, 각자 기억하는 게임.',13,MUTED,400,'middle')
        btn(28,414,304,'친구와 플레이   →',True,48);btn(28,474,304,'혼자 연습',False,45)
        text(180,560,'이전 방 AB12CD로 돌아가기',12,MUTED,400,'middle');text(180,638,'6명 · 7라운드 · 힌트 3개',11,MUTED,400,'middle')
    elif kind=='lobby':
        text(180,101,'원정대를 기다리는 중',22,INK,700,'middle');text(180,132,'AB12CD   ·   5 / 6명',14,MUTED,400,'middle')
        btn(100,151,160,'초대 링크 복사',False,36)
        for i,n in enumerate(NAMES):
            x=27+(i%3)*109;y=226+(i//3)*147;rect(x,y,88,126,PAPER,LINE,6);avatar(x+44,y+39,n if i<5 else '+',False,21);text(x+44,y+85,n if i<5 else '빈 자리',13,INK,600,'middle');text(x+44,y+107,'방장' if i==0 else '합류 완료' if i<5 else '대기',10,MUTED,400,'middle')
        btn(27,562,306,'6명이 모이면 시작',False,46,True)
    else:
        text(180,79,'ROUND 02 / 07',12,MUTED,600,'middle')
        for i,n in enumerate(NAMES):avatar(40+i*56,115,n,i==0,17)
        text(180,160,'내 차례 · 미로의 판',16,INK,700,'middle')
        group('mobile-game-board',-108,78,.6);board(cx=480,top=176,step=65,unit=58,pawn=(3,0),targets=True);end()
        rect(18,438,324,47,PAPER,LINE,6);text(34,467,'힌트  3 / 3',14,INK,600);text(326,467,'로테이션 01',11,MUTED,400,'end')
        text(180,523,'연결된 점으로 이동하세요.',17,INK,700,'middle');text(180,550,'다른 사람의 이동도 기억해두세요.',12,MUTED,400,'middle')
        btn(18,581,324,'힌트 사용하기  −1',True,48)
        if kind=='hint':
            rect(0,0,360,680,INK,extra='opacity="0.32"');rect(18,191,324,335,PAPER,INK,10)
            text(40,229,'당신만의 단서',20,INK,700);cross(316,216,5);text(180,276,'✓ 지뢰가 없어요',23,INK,700,'middle')
            group('mobile-hint-full-board',45.6,260,.28);board(selected=True);end()
            text(180,433,'닫으면 답변이 사라집니다.',12,MUTED,400,'middle');btn(40,457,280,'기억했어요 · 닫기',True,43)


rows=[
('01','게임에 들어가기','입장 화면은 메뉴처럼, 대기실은 함께 모이는 테이블처럼 구성합니다.',[
('H01','타이틀 / 홈','home','첫 진입 · 친구와 플레이 → H02 · 연습 → P01'),
('H02','이름 입력 / 방 만들기','create','H01에서 진입 · 생성 → L01 · 코드 참가 → H03'),
('H03','코드로 참가','join','초대 링크는 코드 자동 입력 · 참가 → L01'),
('L01','대기실 / 초대','lobby','방장만 시작 가능 · 6명 합류 + 시작 → P01')]),
('02','라운드를 준비하기','편집·유효성 오류·준비 완료를 같은 보드 장면의 상태로 구분합니다.',[
('P01','지뢰 배치 / 편집','place','비공개 선분 편집 · 경로 유효 → P03 · 오류 → P02'),
('P02','배치 / 안전 경로 없음','invalid','배치 준비 버튼 비활성 · 지뢰 제거 → P01'),
('P03','배치 완료 / 다른 사람 대기','ready','내 배치 잠금 · 전원 준비 → G01'),
('G01','내 차례 시작 / 전환 연출','intro','제안한 짧은 연출 상태 · 자동 종료 → G02')]),
('03','관찰하고 이동하기','보드가 주연입니다. 플레이어 순서와 내 자원은 작은 HUD에 고정합니다.',[
('G02','내 차례 / 출발점 선택','spawn','밑변 5곳 중 출발 → G03 · 힌트 → G05'),
('G03','내 차례 / 인접점 이동','move','안전 이동 약 650ms · 폭발 → G07 · 정상 → R01/R02'),
('G04','다른 사람 차례 / 관찰','watch','보드 조작 잠금 · 공개 이동과 폭발만 관찰'),
('G05','힌트 / 선분 선택','pick','지뢰 설치 가능 선분 선택 → G06 · 취소 → G02/G03')]),
('04','기억하고 다음으로 넘어가기','순간 정보를 기억하게 하고, 폭발·턴 변경·판 전달을 분명하게 구분합니다.',[
('G06','개인 힌트 / 답 공개','hint','본인 전용 · 코인 −1 · 닫으면 답 제거 → 이전 탐색'),
('G07','폭발 / 다음 차례 대기','explosion','약 1.8초 공개 후 다음 사람 · 전원 실패 → G08'),
('G08','전원 실패 / 판 전달','rotation','약 1.4초 입력 잠금 · 자기 판 건너뛰기 → 탐색'),
('R01','라운드 결과','round','1–6라운드 정상 도착 · 방장이 다음 배치 → P01')]),
('05','게임 마무리와 공통 상태','최종 결과, 도움말, 홈 이동, 연결 복구를 독립된 상태로 준비합니다.',[
('R02','최종 결과 / 공동 우승','final','7라운드 정상 도착 · 새 게임 → P01 · 점수 초기화'),
('O01','플레이 방법','rules','모든 화면에서 열기 · 닫으면 기존 화면 복귀'),
('O02','홈 이동 확인','exit','온라인 자리는 유지 · 데모는 종료 · 확인 → H01'),
('O03','연결 확인 / 복구','connection','현재 장면 유지 + 입력 잠금 · 만료 시 홈 오류 안내')])]
