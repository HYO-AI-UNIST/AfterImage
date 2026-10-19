"""Blender 5.x: build original, texture-free Quiet Mine game models.

blender --background --python scripts/design/build_game_models.py
"""
import bpy, math, random
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/game/models'; OUT.mkdir(parents=True,exist_ok=True)
SOURCE=ROOT/'assets/source'; SOURCE.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version=0
def material(name,color,emission=0):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=.95
    if emission:bs.inputs['Emission Color'].default_value=(*color,1);bs.inputs['Emission Strength'].default_value=emission
    return m
iron=material('Iron - charcoal',(.13,.19,.23)); rim=material('Rim - slate',(.28,.36,.40));black=material('Deep shadow',(.025,.045,.06))
coat=material('Work coat',(.22,.27,.26));skin=material('Face - muted',(.48,.40,.30));helmet=material('Helmet - player color',(.68,.44,.14))
wood=material('Timber',(.25,.16,.105)); rock=material('Rock',(.11,.18,.23));warm=material('Lamp - emissive',(.98,.65,.22),2)
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
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.export_scene.gltf(filepath=str(OUT/f'{name}.glb'),export_format='GLB',use_selection=True,export_yup=True,export_materials='EXPORT',export_cameras=False,export_lights=False)
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

for i,o in enumerate([o for o in bpy.context.scene.objects if o.type=='EMPTY']):o.location.x=i*4
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'quiet-mine-kit.blend'))
print('Exported five original GLB assets and editable Blender source.')
