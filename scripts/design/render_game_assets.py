"""Render the actual editable Blender kit for the asset catalogue."""
import bpy
from mathutils import Vector
from pathlib import Path

root=Path(__file__).resolve().parents[2]
bpy.ops.wm.open_mainfile(filepath=str(root/'assets/source/quiet-mine-kit.blend'))
scene=bpy.context.scene
scene.render.engine='BLENDER_EEVEE'
scene.render.resolution_x=1800;scene.render.resolution_y=760;scene.render.resolution_percentage=100
scene.render.film_transparent=True
scene.view_settings.view_transform='Standard'
scene.world.color=(.15,.19,.23)
bpy.ops.object.camera_add(location=(8,-18,14))
camera=bpy.context.object
camera.rotation_euler=(Vector((8,0,1))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO';camera.data.ortho_scale=22
scene.camera=camera
for name,location,energy,size,color in [('Key',(5,-5,12),1700,12,(.8,.9,1)),('Fill',(12,4,9),1100,10,(1,.73,.42))]:
    bpy.ops.object.light_add(type='AREA',location=location)
    light=bpy.context.object;light.name=name;light.data.energy=energy;light.data.shape='DISK';light.data.size=size;light.data.color=color
    light.rotation_euler=(Vector((8,0,0))-light.location).to_track_quat('-Z','Y').to_euler()
scene.render.image_settings.file_format='PNG'
scene.render.filepath='/private/tmp/mindminer-model-kit.png'
bpy.ops.render.render(write_still=True)
