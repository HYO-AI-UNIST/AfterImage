"""Render the separate title diorama from its saved Blender scene."""
import bpy
from pathlib import Path
root=Path(__file__).resolve().parents[2]
bpy.ops.wm.open_mainfile(filepath=str(root/'assets/source/quiet-mine-title.blend'))
scene=bpy.context.scene
scene.render.engine='BLENDER_EEVEE'
scene.render.resolution_x=1400;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.world=bpy.data.worlds.new('Title charcoal environment')
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.008,.012,.017,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.3
scene.render.image_settings.file_format='PNG'
scene.render.filepath=str(root/'docs/game/title-diorama-render.png')
bpy.ops.render.render(write_still=True)
