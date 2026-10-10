"""Run with Blender: blender -b --python scripts/render-icons.py.

Builds the original orthographic relief artwork and all Expo icon variants.
No external textures or fonts are required. Colors match the app's tabletop UI.
"""
from pathlib import Path
import math
import bpy
from mathutils import Vector

KIND = 'checkers'
ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets'
ASSETS.mkdir(parents=True, exist_ok=True)
ART = ASSETS / 'artwork'
ART.mkdir(exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def material(name, hex_color, emission=False):
    h=hex_color.lstrip('#');rgb=tuple(int(h[i:i+2],16)/255 for i in (0,2,4))
    # Blender's shader RGB is linear; convert authored sRGB colors.
    linear=tuple(c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in rgb)
    m=bpy.data.materials.new(name);m.use_nodes=True
    shader=m.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value=(*linear,1)
    shader.inputs['Roughness'].default_value=.72
    if emission:
        emitter=m.node_tree.nodes.new('ShaderNodeEmission')
        emitter.inputs['Color'].default_value=(*linear,1)
        m.node_tree.links.new(emitter.outputs['Emission'],m.node_tree.nodes.get('Material Output').inputs['Surface'])
    return m

navy=material('Tabletop navy','#19232d',True)
teal=material('Timeline teal','#88c9c0')
gold=material('Crown brass','#e8bd70')
cream=material('Warm ivory','#e7d3ad')
walnut=material('Walnut squares','#8a5a3c')
edge=material('Walnut rim','#5a3a26')
red=material('Red checker' if KIND=='checkers' else 'Red disc','#e8333f' if KIND=='checkers' else '#ff4d5a')
ink=material('Black checker','#262633')
silver=material('Light checker edge','#c9cbe6')
blue=material('Classic blue','#2a55c8')
blue_edge=material('Blue rim','#1d3d95')
yellow=material('Yellow disc','#ffd23f')

objects=[]
def cube(name,loc,dimensions,mat,bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
    o=bpy.context.object;o.name=name;o.dimensions=dimensions
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=o.modifiers.new('Rounded artisan edge','BEVEL');mod.width=bevel;mod.segments=5
        o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    o.data.materials.append(mat);objects.append(o);return o

def disc(name,x,y,z,radius,depth,mat):
    bpy.ops.mesh.primitive_cylinder_add(vertices=64,radius=radius,depth=depth,location=(x,y,z))
    o=bpy.context.object;o.name=name;o.data.materials.append(mat)
    mod=o.modifiers.new('Soft token rim','BEVEL');mod.width=.035;mod.segments=3
    o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');objects.append(o);return o

# Offset board layers stand for parallel timelines without competing with the game symbol.
cube('Earlier timeline',(.30,.46,-.46),(5.25,5.25,.14),teal,.24)
cube('Second timeline',(.15,.23,-.28),(5.25,5.25,.14),gold if KIND=='checkers' else blue_edge,.23)
if KIND=='checkers':
    cube('Walnut frame',(0,0,-.04),(5.25,5.25,.24),edge,.23)
    for row in range(4):
        for col in range(4):
            cube(f'Square {row}-{col}',((col-1.5)*1.16,(row-1.5)*1.16,.12),(1.155,1.155,.04),cream if (row+col)%2==0 else walnut,.012)
    for i,(x,y,mat,rim) in enumerate([(-1.74,1.74,ink,silver),(.58,1.74,ink,silver),(-.58,.58,red,edge),(.58,-.58,red,edge),(-1.74,-.58,ink,silver),(1.74,-1.74,red,edge)]):
        disc(f'Token {i} rim',x,y,.23,.48,.13,rim)
        disc(f'Token {i} face',x,y,.32,.405,.08,mat)
        disc(f'Token {i} inset',x,y,.37,.30,.018,mat)
    # A small gold crown identifies a king at icon size.
    points=[(-.29,-.13),(-.36,.20),(-.14,.09),(0,.31),(.14,.09),(.36,.20),(.29,-.13)]
    mesh=bpy.data.meshes.new('Crown silhouette');mesh.from_pydata([(x+.58,y-.58,.395) for x,y in points],[],[list(range(len(points)))]);mesh.update()
    o=bpy.data.objects.new('Crowned red checker',mesh);bpy.context.collection.objects.link(o);o.data.materials.append(gold);objects.append(o)
else:
    plate=cube('Connect Four frame',(0,0,0),(5.25,5.25,.34),blue,.24)
    bpy.context.view_layer.objects.active=plate
    bpy.ops.object.modifier_apply(modifier=plate.modifiers[0].name)
    plate.modifiers.clear()
    for row in range(4):
        for col in range(4):
            x,y=(col-1.5)*1.16,(row-1.5)*1.16
            bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=.44,depth=1.2,location=(x,y,0))
            cutter=bpy.context.object
            mod=plate.modifiers.new('Socket','BOOLEAN');mod.operation='DIFFERENCE';mod.object=cutter
            bpy.context.view_layer.objects.active=plate;bpy.ops.object.modifier_apply(modifier=mod.name)
            bpy.data.objects.remove(cutter,do_unlink=True)
            if row==0:disc(f'Four red discs {col}',x,y,.12,.395,.13,red)
            elif row==1 and col in [0,2]:disc(f'Yellow disc {col}',x,y,.12,.395,.13,yellow)
    # Narrow brass line visually joins the four red discs.
    cube('Winning four',(0,-1.74,.205),(3.85,.055,.022),gold,.02)

scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=False
scene.render.threads_mode='FIXED';scene.render.threads=2
scene.world.color=(.15,.15,.15)
scene.view_settings.view_transform='Standard'
scene.view_settings.look='None'
scene.view_settings.exposure=0;scene.view_settings.gamma=1
bpy.ops.object.light_add(type='AREA',location=(-3,4,8));light=bpy.context.object;light.name='Softbox';light.data.energy=600;light.data.shape='DISK';light.data.size=7
bpy.ops.object.light_add(type='AREA',location=(4,-2,5));bpy.context.object.data.energy=180;bpy.context.object.data.size=6
bpy.ops.object.camera_add(location=(.15,.18,12));camera=bpy.context.object;camera.data.type='ORTHO';camera.data.ortho_scale=7.5;scene.camera=camera
background=cube('Opaque icon background',(0,0,-1.1),(25,25,.1),navy)
objects.remove(background)
scene.render.resolution_x=1024;scene.render.resolution_y=1024;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.film_transparent=True

def render(name,transparent=False,scale=7.5,mono=False):
    background.hide_render=transparent;camera.data.ortho_scale=scale
    scene.render.image_settings.color_mode='RGBA' if transparent else 'RGB'
    hidden=[]
    if mono:
        for obj in objects:
            if obj.name in ['Earlier timeline','Second timeline','Walnut frame'] or (obj.name.startswith('Square ') and obj.data.materials[0]==walnut):
                obj.hide_render=True;hidden.append(obj)
        white=material('Android monochrome white','#ffffff',True)
        scene.view_layers[0].material_override=white
        # Keep the actual socket holes and silhouette transparent.
    scene.render.filepath=str(ASSETS/name);bpy.ops.render.render(write_still=True)
    scene.view_layers[0].material_override=None
    for obj in hidden:obj.hide_render=False

render('icon.png')
render('android-icon-foreground.png',True,9.0)
render('android-icon-monochrome.png',True,9.0,True)
# Reuse the authored scene's transparent foreground for splash and favicon.
image=bpy.data.images.load(str(ASSETS/'android-icon-foreground.png'),check_existing=False)
image.scale(512,512);image.filepath_raw=str(ASSETS/'splash-icon.png');image.file_format='PNG';image.save()
image=bpy.data.images.load(str(ASSETS/'icon.png'),check_existing=False)
image.scale(64,64);image.filepath_raw=str(ASSETS/'favicon.png');image.file_format='PNG';image.save()
image=bpy.data.images.new('Android solid background',width=1024,height=1024,alpha=False)
image.generated_color=(25/255,35/255,45/255,1);image.filepath_raw=str(ASSETS/'android-icon-background.png');image.file_format='PNG';image.save()
for generated in list(bpy.data.images):
    if generated.name != 'Render Result':bpy.data.images.remove(generated)
background.hide_render=False;camera.data.ortho_scale=7.5
scene.render.image_settings.color_mode='RGB'
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ART/'icon.blend'))
print('Completed',KIND,'asset family',ASSETS)
