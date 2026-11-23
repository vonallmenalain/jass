# Training der Kartenerkennung (Heatmap pro Karte, Stufe 8).
#   python train.py <daten> <schritte> <ausgabe.pt> [start.pt]
import sys, os, time, glob, json, math
import cv2, numpy as np, torch, torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from netz import Netz

MITTEL = np.array([0.485, 0.456, 0.406], np.float32); STD = np.array([0.229, 0.224, 0.225], np.float32)
STUFE = 8

def bild_tensor(bgr):
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255
    return torch.from_numpy(((rgb - MITTEL) / STD).transpose(2, 0, 1).copy())

class Fächer(Dataset):
    def __init__(self, dateien): self.d = dateien
    def __len__(self): return len(self.d)
    def __getitem__(self, i):
        img = cv2.imread(self.d[i]); z = np.load(self.d[i][:-4] + '.npy')
        H, W = img.shape[:2]; h, w = H // STUFE, W // STUFE
        hm = np.zeros((36, h, w), np.float32); gew = np.ones((36, h, w), np.float32)
        gy, gx = np.mgrid[0:h, 0:w].astype(np.float32)
        for k, x, y, g, wt in z:
            k = int(k); cx, cy = (x + 0.5) / STUFE - 0.5, (y + 0.5) / STUFE - 0.5
            s = max(0.7, g / STUFE / 3.5)
            gauss = np.exp(-((gx - cx) ** 2 + (gy - cy) ** 2) / (2 * s * s))
            if wt > 0:
                hm[k] = np.maximum(hm[k], gauss)
                iy, ix = int(round(cy)), int(round(cx))
                if 0 <= iy < h and 0 <= ix < w: hm[k, iy, ix] = 1.0
            else:
                gew[k][gauss > 0.05] = 0
        return bild_tensor(img), torch.from_numpy(hm), torch.from_numpy(gew)

def fokal(logit, ziel, gew):
    p = logit.sigmoid().clamp(1e-4, 1 - 1e-4)
    pos = (ziel >= 0.999).float()
    neg = (1 - pos) * gew
    lp = -torch.log(p) * (1 - p) ** 2 * pos
    ln = -torch.log(1 - p) * p ** 2 * (1 - ziel) ** 4 * neg
    n = pos.sum().clamp(min=1)
    return (lp.sum() + ln.sum()) / n

# ---- Auswertung an echten Fotos ----
NAME_F = {'S': 0, 'H': 1, 'K': 2, 'E': 3}; NAME_W = {'6': 0, '7': 1, '8': 2, '9': 3, '10': 4, 'B': 5, 'D': 6, 'K': 7, 'A': 8}
def code(s): return NAME_F[s[0]] * 9 + NAME_W[s[1:]]
# Echte Handfotos (nicht im Repo): ERKENNUNG_FOTOS=<ordner> mit <name>.jpg und
# soll.json {"<name>": ["E10", "KB", "EB|ED", …]} – «|» lässt mehrere gelten.
U = os.environ.get('ERKENNUNG_FOTOS', '')
SOLL = {}
if U and os.path.exists(os.path.join(U, 'soll.json')):
    U = U.rstrip('/') + '/'
    SOLL = {k: [[code(a) for a in e.split('|')] for e in v] for k, v in json.load(open(U + 'soll.json')).items()}
FOTOS = {}
def foto(name, kurz):
    if (name, kurz) not in FOTOS:
        img = cv2.imread(U + name + '.jpg'); H, W = img.shape[:2]
        s = kurz / min(H, W); nh, nw = int(round(H * s / 32)) * 32, int(round(W * s / 32)) * 32
        FOTOS[(name, kurz)] = bild_tensor(cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA))
    return FOTOS[(name, kurz)]
def wertung(pred, soll):
    offen = [list(s) for s in soll]; richtig = 0
    for k in pred:
        for j, s in enumerate(offen):
            if k in s: richtig += 1; offen.pop(j); break
    return richtig
@torch.no_grad()
def echt(netz, groessen=(320, 384)):
    netz.eval(); erg = {}
    for kurz in groessen:
        r = []
        for name, soll in SOLL.items():
            p = netz(foto(name, kurz)[None]).sigmoid()[0].amax(dim=(1, 2))
            top = torch.argsort(p, descending=True)[:9].tolist()
            r.append(wertung(top, soll))
        erg[kurz] = (sum(r), r)
    netz.train(); return erg

if __name__ == '__main__':
    daten, schritte, aus = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    torch.set_num_threads(4)
    dateien = sorted(glob.glob(daten + '/*.jpg'))
    dl = DataLoader(Fächer(dateien), batch_size=24, shuffle=True, num_workers=2, drop_last=True, persistent_workers=True)
    netz = Netz()
    if len(sys.argv) > 4: netz.load_state_dict(torch.load(sys.argv[4]))
    rück = [p for n, p in netz.named_parameters() if n.startswith('s')]
    rest = [p for n, p in netz.named_parameters() if not n.startswith('s')]
    opt = torch.optim.AdamW([{'params': rück, 'lr': 6e-4}, {'params': rest, 'lr': 2e-3}], weight_decay=1e-4)
    basis = [g['lr'] for g in opt.param_groups]
    schritt, t0, verlauf = 0, time.time(), []
    while schritt < schritte:
        for x, ziel, gew in dl:
            f = min(1, (schritt + 1) / 300) * 0.5 * (1 + math.cos(math.pi * schritt / schritte))
            for g, b in zip(opt.param_groups, basis): g['lr'] = b * f
            loss = fokal(netz(x), ziel, gew)
            opt.zero_grad(); loss.backward(); opt.step()
            verlauf.append(loss.item()); schritt += 1
            if schritt % 100 == 0:
                print(f'{schritt:6d}  Verlust {np.mean(verlauf[-100:]):.3f}  {(time.time() - t0) / 60:.1f} min', flush=True)
            if (schritt % 1000 == 0 or schritt == schritte) and SOLL:
                e = echt(netz)
                print('   echte Fotos (richtig von 108): ' + '  '.join(f'{k}px: {v[0]} {v[1]}' for k, v in e.items()), flush=True)
            if schritt % 1000 == 0: torch.save(netz.state_dict(), aus)
            if schritt >= schritte: break
    torch.save(netz.state_dict(), aus)
