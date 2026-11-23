# Kartenbilder für den Fächer-Generator (gen.py) sammeln: tex/bibliothek.npz
#
#   python bibliothek.py [ordner ...]
#
# Immer dabei: karten/foto/*.webp aus dem Repo (unser Kartensatz). Weitere
# Ordner mit Bildern derselben Karten machen das Netz robuster (andere Fotos,
# anderes Licht, ein zweiter Satz): Dateinamen wie in karten/foto, also
# <farbe>-<wert>.<png|jpg|webp> mit farbe ∈ schaufel herz kreuz ecke und
# wert ∈ 6 7 8 9 10 bauer dame koenig ass. Für das Netz in der App waren es
# vier Quellen (diese Fotos, zwei flach fotografierte Sätze, die PDF-Vorlage
# des Herstellers) – sie liegen nicht im Repo.
import sys, os, glob
import cv2, numpy as np

HIER = os.path.dirname(os.path.abspath(__file__))
FARBE = ['schaufel', 'herz', 'kreuz', 'ecke']
WERT = ['6', '7', '8', '9', '10', 'bauer', 'dame', 'koenig', 'ass']
W, H = 256, 400

def lies(pfad):
    img = cv2.imread(pfad, cv2.IMREAD_UNCHANGED)
    if img is None: return None
    if img.ndim == 3 and img.shape[2] == 4:  # Alpha (runde Ecken) auf Weiss
        a = img[..., 3:4].astype(np.float32) / 255
        img = (img[..., :3] * a + 245 * (1 - a)).astype(np.uint8)
    return cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA)

ordner = [os.path.join(HIER, '..', '..', 'karten', 'foto')] + sys.argv[1:]
bilder, klassen, quellen = [], [], []
for o in ordner:
    n = 0
    for k in range(36):
        for endung in ('webp', 'png', 'jpg'):
            p = os.path.join(o, f'{FARBE[k // 9]}-{WERT[k % 9]}.{endung}')
            if os.path.exists(p):
                img = lies(p)
                if img is not None:
                    bilder.append(img); klassen.append(k); quellen.append(os.path.basename(os.path.normpath(o))); n += 1
                break
    print(o, n, 'Karten')
os.makedirs(os.path.join(HIER, 'tex'), exist_ok=True)
np.savez_compressed(os.path.join(HIER, 'tex', 'bibliothek.npz'), bilder=np.stack(bilder), klasse=np.array(klassen), quelle=np.array(quellen))
print(len(bilder), 'Vorlagen →', os.path.join('tex', 'bibliothek.npz'))
