# Netz → ONNX für den Browser; Faltungsgewichte als int8 je Ausgabekanal
# (DequantizeLinear), gerechnet wird weiter in float32.
#   python export_onnx.py <netz.pt> <ziel.onnx>
import sys, numpy as np, torch, onnx
from onnx import helper, numpy_helper, TensorProto
from netz import Netz

pt, ziel = sys.argv[1], sys.argv[2]
m = Netz(vortrainiert=False); m.load_state_dict(torch.load(pt)); m.eval()
x = torch.randn(1, 3, 512, 384)
roh = ziel.replace('.onnx', '-f32.onnx')
torch.onnx.export(m, x, roh, input_names=['bild'], output_names=['karten'], opset_version=17,
                  dynamic_axes={'bild': {2: 'h', 3: 'w'}, 'karten': {2: 'h8', 3: 'w8'}}, do_constant_folding=True, dynamo=False)
g = onnx.load(roh)
init = {i.name: i for i in g.graph.initializer}
neu_init, neu_knoten, ersetzt = [], [], set()
for n in g.graph.node:
    if n.op_type != 'Conv' or len(n.input) < 2 or n.input[1] not in init or n.input[1] in ersetzt: continue
    w = numpy_helper.to_array(init[n.input[1]]).astype(np.float32)
    if w.size < 512: continue
    c = w.shape[0]
    skala = np.abs(w.reshape(c, -1)).max(1) / 127.0
    skala[skala == 0] = 1e-8
    q = np.clip(np.round(w / skala.reshape(-1, 1, 1, 1)), -127, 127).astype(np.int8)
    name = n.input[1]
    neu_init += [numpy_helper.from_array(q, name + '_q'), numpy_helper.from_array(skala.astype(np.float32), name + '_s'),
                 numpy_helper.from_array(np.zeros(c, np.int8), name + '_z')]
    neu_knoten.append(helper.make_node('DequantizeLinear', [name + '_q', name + '_s', name + '_z'], [name], axis=0, name=name + '_deq'))
    ersetzt.add(name)
behalten = [i for i in g.graph.initializer if i.name not in ersetzt]
del g.graph.initializer[:]
g.graph.initializer.extend(behalten + neu_init)
alt = list(g.graph.node)
del g.graph.node[:]
g.graph.node.extend(neu_knoten + alt)
onnx.checker.check_model(g)
onnx.save(g, ziel)
import os, onnxruntime as ort
for p in (roh, ziel):
    print(os.path.basename(p), round(os.path.getsize(p) / 1e6, 2), 'MB')
s1 = ort.InferenceSession(roh); s2 = ort.InferenceSession(ziel)
xb = np.random.randn(1, 3, 384, 288).astype(np.float32)
with torch.no_grad(): t = m(torch.from_numpy(xb)).numpy()
a = s1.run(None, {'bild': xb})[0]; b = s2.run(None, {'bild': xb})[0]
print('max. Abweichung f32:', float(np.abs(a - t).max()), ' int8-Gewichte:', float(np.abs(b - t).max()))
print('Knoten:', sorted({n.op_type for n in g.graph.node}))
