"""Blender 5.x: build original, textured Quiet Mine models and a hand-dressed mine diorama.

blender --background --python scripts/design/build_game_models.py
"""
import bpy, math, random, json, os
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/game/models'; OUT.mkdir(parents=True,exist_ok=True)
SOURCE=ROOT/'assets/source'; SOURCE.mkdir(parents=True,exist_ok=True)
GRID=int(os.environ.get('MINDMINER_GRID','4'))
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version=0
def material(name,color,emission=0):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=.95
    if emission:bs.inputs['Emission Color'].default_value=(*color,1);bs.inputs['Emission Strength'].default_value=emission
    return m
iron=material('Iron - charcoal',(.13,.19,.23)); rim=material('Rim - slate',(.28,.36,.40));black=material('Deep shadow',(.025,.045,.06))
coat=material('Work coat',(.22,.27,.26));skin=material('Face - muted',(.48,.40,.30));helmet=material('Helmet - player color',(.68,.44,.14))
wood=material('Timber',(.60,.45,.31)); rock=material('Rock',(.35,.45,.54));warm=material('Lamp - emissive',(.80,.72,.52),1.2)
def textured(mat, name):
    tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(ROOT/f'public/game/textures/{name}.png'));tex.image.pack()
    mat.node_tree.links.new(tex.outputs['Color'],mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
for mat,name in [(wood,'timber'),(rock,'shale'),(iron,'iron'),(rim,'iron')]:textured(mat,name)
gravel=material('Ballast',(.3,.32,.34));textured(gravel,'gravel')
floor=material('Ground stone',(.11,.13,.15));textured(floor,'floor')
water=material('Still drainage water',(.025,.055,.07));water.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.28
ore=material('Oxidized copper veins',(.11,.22,.23),.06)
red=material('Danger - red ember',(.95,.10,.035),3)

objects=[]
def add(obj,mat,name):
    obj.name=name;obj.data.materials.append(mat);objects.append(obj);return obj
def box(name,loc,scale,mat):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=add(bpy.context.object,mat,name);o.scale=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);return o
def cylinder(name,loc,radius,depth,mat,vertices=12,rotation=(0,0,0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=loc,rotation=rotation);return add(bpy.context.object,mat,name)
def ico(name,loc,scale,mat):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=loc);o=add(bpy.context.object,mat,name);o.scale=scale;return o
def export(name):
    if GRID!=4 and name!='mine-level':
        root=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(root)
        for o in objects:o.parent=root
        objects.clear();return root
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    # Explicit UVs are exported with embedded painted PNG maps in each GLB.
    if name!='main-menu-diorama':
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=1.15,island_margin=.02);bpy.ops.object.mode_set(mode='OBJECT')
    if name=='mine-level':
        # Ground UVs use physical coordinates: 6 world units per tile, aligned across slabs.
        for o in objects:
            uv=o.data.uv_layers.active
            for face in o.data.polygons:
                if o.data.materials[face.material_index]==floor:
                    for li in face.loop_indices:
                        p=o.matrix_world @ o.data.vertices[o.data.loops[li].vertex_index].co
                        uv.data[li].uv=(p.x/6,p.y/6)
    if name in ['mine-level','main-menu-diorama']:
        # Join static meshes per material: detailed scenery without hundreds of draw calls.
        batches={}
        for o in list(objects):batches.setdefault(o.data.materials[0].name,[]).append(o)
        objects.clear()
        for group in batches.values():
            bpy.ops.object.select_all(action='DESELECT')
            for o in group:o.select_set(True)
            bpy.context.view_layer.objects.active=group[0];bpy.ops.object.join();objects.append(bpy.context.object)
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects:o.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
    output_name=f'{name}-{GRID}' if GRID!=4 else name
    bpy.ops.export_scene.gltf(filepath=str(OUT/f'{output_name}.building.glb'),export_format='GLB',use_selection=True,export_yup=True,export_materials='EXPORT',export_cameras=False,export_lights=False)
    (OUT/f'{output_name}.building.glb').replace(OUT/f'{output_name}.glb')
    root=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(root)
    for o in objects:o.parent=root
    objects.clear();return root

box('Cart floor',(0,0,.48),(1.25,1.65,.15),iron)
for x in [-.63,.63]:box('Cart side',(x,0,.83),(.09,1.7,.64),iron)
for y in [-.83,.83]:box('Cart end',(0,y,.83),(1.28,.09,.64),rim)
for x in [-.65,.65]:box('Cart rim',(x,0,1.17),(.13,1.82,.09),rim)
for y in [-.87,.87]:box('Cart rim',(0,y,1.17),(1.42,.12,.09),rim)
for x in [-.75,.75]:
    for y in [-.56,.56]:cylinder('Wheel',(x,y,.30),.26,.16,black,12,(0,math.pi/2,0));cylinder('Wheel hub',(x*1.015,y,.30),.12,.17,rim,10,(0,math.pi/2,0))
box('Miner torso',(0,.08,1.21),(.64,.43,.65),coat)
box('Miner collar',(0,-.01,1.48),(.54,.44,.14),black)
ico('Face',(0,-.02,1.68),(.23,.22,.27),skin)
box('Face shadow',(0,-.22,1.72),(.38,.025,.105),black)
box('Scarf',(0,-.20,1.54),(.40,.13,.15),coat)
for x in [-.39,.39]:
    o=box('Sleeve',(x,-.21,1.23),(.23,.55,.24),coat);o.rotation_euler.x=.35
    box('Glove',(x,-.47,1.16),(.22,.22,.20),black)
cylinder('Helmet brim',(0,-.04,1.88),.36,.055,helmet,14)
ico('Helmet crown',(0,0,1.92),(.31,.30,.22),helmet)
cylinder('Headlamp housing',(0,-.31,1.96),.105,.085,black,12,(math.pi/2,0,0))
cylinder('Headlamp lens',(0,-.36,1.96),.075,.03,warm,12,(math.pi/2,0,0))
cartroot=export('miner-cart')

for x in [-1.25,1.25]:box('Support post',(x,0,1.45),(.24,.35,2.9),wood)
box('Cross beam',(0,0,2.92),(2.95,.38,.32),wood)
for x in [-1.25,1.25]:
    o=box('Brace',(x*.75,0,2.57),(.17,.30,.85),wood);o.rotation_euler.y=x*.4
export('timber-arch')

box('Lantern base',(0,0,.12),(.30,.27,.07),black)
box('Lantern back',(0,.12,.43),(.30,.04,.65),black)
box('Lantern glass',(0,-.015,.44),(.22,.23,.45),warm)
for x in [-.14,.14]:box('Lantern edge',(x,0,.43),(.035,.29,.65),rim)
box('Lantern cap',(0,0,.77),(.36,.33,.10),rim)
box('Lantern handle',(0,0,.9),(.04,.06,.20),iron)
export('lantern')

box('Crate',(0,0,.48),(.96,.96,.96),wood)
for z in [.10,.84]:
    for y in [-.49,.49]:box('Crate strap',(0,y,z),(1.04,.07,.10),rim)
for x in [-.49,.49]:box('Crate strap',(x,0,.47),(.07,1.02,.10),rim)
export('supply-crate')

o=ico('Rock mass',(0,0,.78),(1.3,.95,1.35),rock)
random.seed(8)
for v in o.data.vertices:v.co*=random.uniform(.84,1.16)
export('cave-rock')

# A complete static level, built around the exact 15-node / 30-edge graph.
# Blender coordinates are X/Y floor, Z height; export maps +Z to WebGL +Y.
random.seed(319)
layout=json.loads((ROOT/'lib/mine/level-layout.json').read_text())['nodes']
if GRID!=4:layout={f'{r}-{c}':[(c-r/2)*14.4/GRID,-7.2+r*12.4707658145/GRID] for r in range(GRID+1) for c in range(r+1)}
def node(row,col):
    x,z=layout[f'{row}-{col}'];return (x,-z)
def slab(name,polygon,top,bottom,mat):
    # Each irregular mass has exposed, deliberately cut cliff faces.
    n=len(polygon);verts=[(x,-z,top) for x,z in polygon]+[(x,-z,bottom) for x,z in polygon]
    faces=[tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]
    faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj);add(obj,mat,name)
    if mat==rock:
        obj.data.materials.append(floor);obj.data.polygons[0].material_index=1
    return obj
# Three irregular landforms are split by a diagonal, deep mining fault.
slab('West hanging shelf',[(-13.8,-9.7),(-9.4,-11.8),(-3,-10.4),(-2,-7),(-5.5,-3.8),(-6.8,-.5),(-10.6,2.7),(-13.4,7.8),(-15.2,5.1),(-14.5,.2)],-.22,-3.8,rock)
slab('East rail yard',[(-1,-10.8),(5.2,-12),(10.9,-10.2),(14,-6.7),(13.4,-1.2),(15,3.4),(13.1,8.1),(11.1,10.8),(6.2,9.7),(4.5,6.2),(.3,3.3),(-3.5,1.4),(-2.8,-2.5)],-.22,-3.2,rock)
slab('Departure apron',[(-10,3.8),(-7,4),(-2.8,3.6),(.8,4.2),(5.5,3.7),(9.5,4),(11,7.5),(8,9.4),(3,8.8),(-3.3,9.5),(-9.7,8),(-11.5,6.6)],-.22,-2.8,rock)
# Visible depths and bottom sediment, suspended below the rails.
slab('Fault bed',[(-12,-1),(-2,-8),(2,-6),(0,1),(7,5),(4,7),(-4,4),(-13,5)],-3.9,-4.4,black)
slab('Subterranean water',[(-10.8,.5),(-3.2,-6.7),(-.5,-5),(-2.1,1),(4.8,4.6),(3.5,5.3),(-3,2.8)],-3.82,-3.9,water)
for i in range(7):
    ico('Fault rim outcrop',(-11+i*.52,2.8-i*.64,-1.0),(1.1,.8,1.6),rock)

def beam(name,a,b,width,depth,mat):
    from mathutils import Vector
    mid=(Vector(a)+Vector(b))/2
    o=box(name,mid,(width,depth,(Vector(b)-Vector(a)).length),mat)
    o.rotation_euler=(Vector(b)-Vector(a)).to_track_quat('Z','Y').to_euler();return o
# Railway ballast is individually laid, with retaining stones along the beds.
for row in range(GRID+1):
    for col in range(row+1):
        a=node(row,col)
        destinations=[]
        if col<row:destinations.append(node(row,col+1))
        if row<GRID:destinations.extend([node(row+1,col),node(row+1,col+1)])
        for b in destinations:
            beam('Crushed-stone track bed',(*a,-.08),(*b,-.08),.82,.16,gravel)
            dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy);nx,ny=-dy/length,dx/length
            for t in [.22,.52,.81]:
                for side in [-1,1]:
                    x=a[0]+dx*t+nx*side*.52;y=a[1]+dy*t+ny*side*.52
                    o=box('Retaining block',(x,y,-.12),(.35,.23,.12),rock);o.rotation_euler.z=math.atan2(dy,dx)
# Rails are carried over the open fault by steel girders and diagonal trusses.
for row in range(GRID):
    for col in range(row+1):
        a=node(row,col)
        for b in [node(row+1,col),node(row+1,col+1)]:
            beam('Bridge undergirder',(*a,-.40),(*b,-.40),.16,.28,iron)
            mid=((a[0]+b[0])/2,(a[1]+b[1])/2)
            for side in [-1,1]:
                beam('Bridge lattice', (a[0]+side*.34,a[1],-.3),(mid[0]+side*.34,mid[1],-1.12),.08,.09,rim)
                beam('Bridge lattice', (mid[0]+side*.34,mid[1],-1.12),(b[0]+side*.34,b[1],-.3),.08,.09,rim)
            beam('Deep steel trestle',(mid[0],mid[1],-.4),(mid[0],mid[1],-3.1),.16,.16,iron)
# East wall: an industrial service yard with high walkways and pipework.
for j in range(4):
    x=11.7+j*.28;y=6.7-j*3.4
    box('Asymmetric service ledge',(x,y,.15+j*.13),(2.5,2.8,.35+j*.23),rock)
    for k in range(3):box('Cut shale bench',(x+1,y,.66+k*.37),(1.2,2.7,.29),rock)
for y in [-5.2,-2.5,0,2.5,5.0]:
    for j in range(5):box('Weathered east catwalk',(12,y+j*.23,.78),(1.7,.18,.16),wood)
    box('Safety post',(12.7,y,1.12),(.10,.12,.72),iron)
beam('Catwalk safety cable',(12.7,-5,1.43),(12.7,6.2,1.43),.07,.07,rim)
for z in [1.6,1.95]:beam('Main drainage pipeline',(12.3,-7,z),(12.3,7,z),.18,.18,iron)
for y in [-6,-2,2,6]:box('Pipe mounting bracket',(12.3,y,1.78),(.33,.15,.65),rim)
# West shelf: abandoned excavation, exposed timber cribbing and a collapsed tunnel.
for y in [-5.8,-2,1.7,5.0]:
    box('Abandoned west deck',(-12.1,y,.2),(2.1,1.6,.18),wood)
    for j in range(4):
        box('Crib timber',(-12.1,y,-.25-j*.42),(2.2,.20,.20),wood)
        box('Crib cross timber',(-12.6,y,-.45-j*.42),(.20,1.9,.20),wood)
for j in range(14):
    x=-12.7+random.random()*2.3;y=-7+random.random()*12
    ico('Collapsed tunnel rubble',(x,y,.25),(.22+random.random()*.3,.28,.2+random.random()*.4),rock)
# Winch structure and suspended cable make the ravine's depth readable.
for x in [-10.5,-8.6]:beam('Winch tower',(x,5.1,.15),(x,5.1,3.2),.18,.22,iron)
beam('Winch crosshead',(-10.8,5.1,3.2),(-8.3,5.1,3.2),.2,.2,rim)
beam('Cross-canyon cable',(-9.6,5.1,3.1),(9.8,7.5,2.1),.035,.035,iron)
# Entrance apron and five deliberate departure stations, each with a ramp.
for i in range(GRID+1):
    x,y=node(GRID,i)
    box('Departure platform',(x,y-.45,.06),(2.25,1.8,.20),wood)
    for k in range(6):box('Deck plank seam',(x-.94+k*.37,y-.45,.168),(.025,1.76,.015),black)
    for side in [-1,1]:box('Station marker post',(x+side*.96,y-.95,.55),(.12,.12,.85),iron)
# Elevator shaft above the goal, with layered framing, chain and landing steps.
shaft_start=len(objects)
for side in [-1,1]:
    for z in [.6,1.8,3]:box('Shaft masonry',(side*1.75,8.9,z),(.9,1.7,1.0),rock)
    beam('Elevator guide rail',(side*.88,8.6,.1),(side*.88,8.6,4.3),.12,.12,rim)
box('Elevator crown',(0,8.8,4.1),(4.4,1.75,.55),rock)
for i in range(6):box('Lift tread',(0,7.05+i*.22,.04+i*.045),(2.3,.24,.12),iron)
for side in [-1,1]:
    beam('Hoist chain',(side*.65,8.25,1),(side*.65,8.25,4),.055,.055,iron)
for o in objects[shaft_start:]:o.location.y-=.2
# Equipment alcove: barrel, spool, ladder, picks, ore and sacks.
for i in range(3):
    x=-10.1+i*.9;y=7.4
    cylinder('Supply barrel',(x,y,.45),.34,.9,wood,12)
    for z in [.13,.74]:cylinder('Barrel steel band',(x,y,z),.35,.06,iron,12)
for side in [-1,1]:beam('Ladder upright',(12+side*.25,3,.7),(12+side*.25,3.5,3.1),.09,.09,wood)
for j in range(7):beam('Ladder rung',(11.75,3+j*.07,.8+j*.33),(12.25,3+j*.07,.8+j*.33),.07,.07,rim)
for i in range(7):
    x=10.3+random.random();y=-7.2+random.random()
    o=ico('Copper crystal',(x,y,.7),(.16,.16,.6+random.random()*.5),ore);o.rotation_euler.y=.2
# The cliff silhouette is jagged and open at the foreground, with high walls behind.
for i in range(14):
    x=-13.5+i*2.05;y=10.2+math.sin(i*1.4)*1.5
    ico('Rear cut-face',(x,y,1.2),(1.8,1.25,2.2+random.random()*1.5),rock)
for side in [-1,1]:
    for y in [-6,-2,2,6]:
        x=side*(13.4+random.random()*.6)
        ico('Side cliff',(x,y,.7),(1.1,1.5,1.7),rock)
        beam('Copper ore seam',(x-side*.9,y-.5,.5),(x-side*.8,y+.7,1.3),.055,.09,ore)
levelroot=export('mine-level')
if GRID!=4:
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/f'quiet-mine-level-{GRID}.blend'))
    raise SystemExit(0)

# Four torn rail ends, visibly lifted toward the blast fracture.
for side in [-1,1]:
    for end in [-1,1]:
        pts=[(side*.15,end*1.65,.19),(side*.15,end*.76,.20),(side*.20,end*.40,.44),(side*.28,end*.22,1.22)]
        for a,b in zip(pts,pts[1:]):beam('Curled torn rail',a,b,.075,.10,rim)
for y in [-1.15,1.15]:box('Split sleeper',(0,y,.08),(.67,.17,.13),wood)
for x in [-.2,.2]:ico('Hot fracture',(x,0,.38),(.07,.13,.13),red)
export('broken-track')

# Separate title-screen diorama: a miniature mine on an industrial exhibition table.
# This is its own model and scene, independent of the live game board.
for source in list(levelroot.children):
    o=source.copy();o.data=source.data.copy();bpy.context.collection.objects.link(o);o.parent=None
    o.location=source.location*.58;o.location.z+=1.4;o.scale=source.scale*.58
    objects.append(o)
box('Title table deck',(0,0,-1.43),(20.5,18.0,.46),iron)
box('Title table edge',(0,0,-1.72),(20.9,18.4,.17),black)
for x in [-8.2,8.2]:
    for y in [-6.5,6.5]:
        box('Title table leg',(x,y,-3.4),(.48,.55,3.6),iron)
        box('Table foot',(x,y,-5.15),(1.2,1.35,.15),rim)
# The miniature railway is modeled into this GLB, including junction decks.
for row in range(5):
    for col in range(row+1):
        x,y=node(row,col);a=(x*.58,y*.58)
        cylinder('Mini junction',(a[0],a[1],1.56),.27,.11,rim,16)
        destinations=[]
        if col<row:destinations.append(node(row,col+1))
        if row<4:destinations.extend([node(row+1,col),node(row+1,col+1)])
        for dest in destinations:
            b=(dest[0]*.58,dest[1]*.58);dx=b[0]-a[0];dy=b[1]-a[1];length=math.hypot(dx,dy);nx,ny=-dy/length,dx/length
            for side in [-1,1]:beam('Mini rail',(a[0]+nx*side*.087,a[1]+ny*side*.087,1.51),(b[0]+nx*side*.087,b[1]+ny*side*.087,1.51),.040,.05,rim)
            for t in [.15,.32,.49,.66,.83]:
                o=box('Mini sleeper',(a[0]+dx*t,a[1]+dy*t,1.44),(.38,.09,.07),wood);o.rotation_euler.z=math.atan2(dy,dx)+math.pi/2
menumodel=export('main-menu-diorama')
# Dedicated editable .blend scene with a composed preview camera and lights.
from mathutils import Vector
title_scene=bpy.data.scenes.new('MindMiner - title diorama')
for o in [menumodel,*menumodel.children]:title_scene.collection.objects.link(o)
camera_data=bpy.data.cameras.new('Title camera');camera=bpy.data.objects.new('Title camera',camera_data);title_scene.collection.objects.link(camera)
camera.location=(12,-21,23);camera.rotation_euler=(Vector((0,0,-.5))-camera.location).to_track_quat('-Z','Y').to_euler();camera_data.type='ORTHO';camera_data.ortho_scale=27;title_scene.camera=camera
for name,loc,power,size in [('Title key',(-4,-2,14),1600,8),('Title rim',(7,4,8),900,5)]:
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.color=(.69,.80,.89)
    light=bpy.data.objects.new(name,data);title_scene.collection.objects.link(light);light.location=loc;light.rotation_euler=(Vector((0,0,0))-light.location).to_track_quat('-Z','Y').to_euler()
# Preview miners live only in the editable title scene; the runtime animates instances separately.
for i,(row,col) in enumerate([(4,0),(4,3),(3,1),(3,3),(2,1),(1,0)]):
    px,py=node(row,col);actor=bpy.data.objects.new(f'Title preview miner {i+1}',None);title_scene.collection.objects.link(actor)
    actor.location=(px*.58,py*.58,1.522);actor.scale=(.42,.42,.42);actor.rotation_euler.z=(i-2)*.23
    for source in cartroot.children:
        copy=source.copy();copy.data=source.data;copy.parent=actor;title_scene.collection.objects.link(copy)
title_scene.render.engine='BLENDER_EEVEE';title_scene.render.resolution_x=1600;title_scene.render.resolution_y=1000;title_scene.render.resolution_percentage=100
for o in [menumodel,*menumodel.children]:
    for collection in list(o.users_collection):
        if collection!=title_scene.collection:collection.objects.unlink(o)


# Arrange sources in a catalogue while keeping the full map separately editable.
for i,o in enumerate([o for o in bpy.context.scene.objects if o.type=='EMPTY' and o not in [levelroot,menumodel]]):o.location.x=24+i*4
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'quiet-mine-kit.blend'))
bpy.context.window.scene=title_scene
for scene in list(bpy.data.scenes):
    if scene!=title_scene:bpy.data.scenes.remove(scene)
keep=set(title_scene.objects)
for o in list(bpy.data.objects):
    if o not in keep:bpy.data.objects.remove(o,do_unlink=True)
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'quiet-mine-title.blend'))
print('Exported eight textured GLBs, the mine level and a separate title-screen Blender scene.')
