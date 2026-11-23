# Künstliche Kartenfächer zum Trainieren der Kartenerkennung.
#
#   python gen.py <ziel> <anzahl> <start> [grösse]
#
# Jedes Bild: zufälliger Hintergrund, Handfläche, 4–9 Karten (meist 9) als
# Fächer um einen Drehpunkt, einzelne Karten auf dem Kopf, Schatten, Daumen,
# leichte Perspektive, dann Licht, Farbe, Spiegelung, Unschärfe, Rauschen, JPEG.
#
# Ziele (Datei <ziel>/<nr>.npy): für jede Karte die Eckfelder (bei Bildkarten
# auch die Mittelstreifen links/rechts), die zu mindestens 50 % sichtbar sind:
# (klasse, x, y, grösse, gewicht); 20–50 % sichtbar → ignorieren (gewicht 0).
import sys, os
import cv2, numpy as np

B = np.load(os.path.join(os.path.dirname(__file__), 'tex', 'bibliothek.npz'))
TEX, TEXK = B['bilder'], B['klasse']
PRO_KLASSE = [np.nonzero(TEXK == k)[0] for k in range(36)]
TH, TW = TEX.shape[1:3]

def runde_maske(w, h, r):
    m = np.zeros((h, w), np.float32)
    cv2.rectangle(m, (r, 0), (w - 1 - r, h - 1), 1, -1); cv2.rectangle(m, (0, r), (w - 1, h - 1 - r), 1, -1)
    for cx, cy in [(r, r), (w - 1 - r, r), (r, h - 1 - r), (w - 1 - r, h - 1 - r)]:
        cv2.circle(m, (cx, cy), r, 1, -1, lineType=cv2.LINE_AA)
    return m
ALPHA = runde_maske(TW, TH, 14)

# Felder im Kartenkoordinatensystem (Anteile von Breite/Höhe)
ECKE = [(0.0, 0.0, 0.33, 0.24), (0.67, 0.0, 1.0, 0.24), (0.0, 0.76, 0.33, 1.0), (0.67, 0.76, 1.0, 1.0)]
MITTE = [(0.0, 0.30, 0.33, 0.70), (0.67, 0.30, 1.0, 0.70)]
def ist_bild(k): return k % 9 in (5, 6, 7)

def hintergrund(rng, S):
    typ = rng.random()
    if typ < 0.35:  # farbiges Rauschen in mehreren Massstäben
        img = np.zeros((S, S, 3), np.float32)
        for g in (2, 4, 8, 16, 32):
            n = rng.random((g, g, 3)).astype(np.float32)
            img += cv2.resize(n, (S, S), interpolation=cv2.INTER_CUBIC) * rng.uniform(0.1, 1.0)
        img = (img - img.min()) / (np.ptp(img) + 1e-6)
        img = img * rng.uniform(40, 255) + rng.uniform(-40, 40, 3)
    else:
        farbe = rng.uniform(0, 255, 3) * rng.uniform(0.2, 1.0)
        img = np.ones((S, S, 3), np.float32) * farbe
        gx, gy = np.meshgrid(np.linspace(-1, 1, S), np.linspace(-1, 1, S))
        img *= (1 + rng.uniform(-0.5, 0.5) * gx + rng.uniform(-0.5, 0.5) * gy)[..., None]
    img = np.clip(img, 0, 255).astype(np.uint8)
    # Formen: Rechtecke, Kreise, Linien, Punktraster (Tastatur), Kartenrücken
    for _ in range(rng.integers(0, 10)):
        f = tuple(int(v) for v in rng.uniform(0, 255, 3))
        t = rng.random()
        if t < 0.3:
            p = rng.integers(-S // 4, S, 2); q = p + rng.integers(10, S // 2, 2)
            cv2.rectangle(img, tuple(int(v) for v in p), tuple(int(v) for v in q), f, -1 if rng.random() < 0.7 else int(rng.integers(1, 5)))
        elif t < 0.5:
            cv2.circle(img, tuple(int(v) for v in rng.integers(0, S, 2)), int(rng.integers(5, S // 4)), f, -1)
        elif t < 0.65:
            cv2.line(img, tuple(int(v) for v in rng.integers(0, S, 2)), tuple(int(v) for v in rng.integers(0, S, 2)), f, int(rng.integers(1, 8)))
        elif t < 0.8:  # Punktraster, oft rot leuchtend
            f = (int(rng.integers(0, 80)), int(rng.integers(0, 80)), int(rng.integers(150, 256))) if rng.random() < 0.7 else f
            x0, y0 = rng.integers(-S // 4, S, 2); d = int(rng.integers(6, 18)); r = max(1, int(d * rng.uniform(0.15, 0.35)))
            for i in range(int(rng.integers(3, 15))):
                for j in range(int(rng.integers(3, 15))):
                    cv2.circle(img, (int(x0 + i * d), int(y0 + j * d)), r, f, -1)
        else:  # Kartenrücken: weisser Rand, farbige Fläche
            w = int(rng.integers(S // 8, S // 3)); h = int(w * 1.56)
            m = np.full((h, w, 3), 245, np.uint8)
            fl = tuple(int(v) for v in rng.uniform(0, 255, 3))
            cv2.rectangle(m, (w // 8, h // 8), (w - w // 8, h - h // 8), fl, -1)
            ang = rng.uniform(0, 360); M = cv2.getRotationMatrix2D((w / 2, h / 2), ang, 1.0)
            M[:, 2] += rng.integers(-w, S, 2)
            maske = cv2.warpAffine(np.ones((h, w), np.uint8), M, (S, S))
            warp = cv2.warpAffine(m, M, (S, S))
            img[maske > 0] = warp[maske > 0]
    if rng.random() < 0.7:
        img = cv2.GaussianBlur(img, (0, 0), rng.uniform(0.5, 4))
    return img

def haut(rng):
    b = np.array([rng.uniform(120, 200), rng.uniform(140, 200), rng.uniform(180, 245)])  # BGR
    return b * rng.uniform(0.55, 1.1)

def ellipse(img, owner, rng, c, ax, ang, farbe, wert_owner=None):
    m = np.zeros(img.shape[:2], np.float32)
    cv2.ellipse(m, (int(c[0]), int(c[1])), (int(ax[0]), int(ax[1])), ang, 0, 360, 1, -1, cv2.LINE_AA)
    # Schattierung über die Ellipse
    gx, gy = np.meshgrid(np.arange(img.shape[1]), np.arange(img.shape[0]))
    d = ((gx - c[0]) * np.cos(np.radians(ang)) + (gy - c[1]) * np.sin(np.radians(ang))) / max(1, ax[0])
    schatt = (1 - 0.25 * np.clip(d, -1, 1))[..., None]
    farbbild = np.clip(farbe[None, None, :] * schatt, 0, 255)
    a = m[..., None]
    img[:] = (img * (1 - a) + farbbild * a).astype(np.uint8)
    if wert_owner is not None: owner[m > 0.5] = wert_owner

def szene(rng, S=320):
    img = hintergrund(rng, S)
    owner = np.full((S, S), -1, np.int16)
    n = 9 if rng.random() < 0.8 else int(rng.integers(4, 10))
    klassen = rng.choice(36, n, replace=False)
    w = rng.uniform(0.17, 0.48) * S; h = w * 1.5625
    P = np.array([rng.uniform(0.15, 0.85), rng.uniform(0.2, 0.95)]) * S
    th0 = rng.uniform(0, 360)
    spread = rng.uniform(5, 14) * (1 if rng.random() < 0.5 else -1)
    pu, pv = rng.uniform(0.2, 0.8) * w, rng.uniform(0.7, 1.05) * h
    schritt = rng.normal(0, 0.012, 2) * w
    # globale Perspektive
    d = S * rng.uniform(0, 0.10)
    quelle = np.float32([[0, 0], [S, 0], [S, S], [0, S]])
    Hg = cv2.getPerspectiveTransform(quelle, quelle + rng.uniform(-d, d, (4, 2)).astype(np.float32))
    def nach_bild(pts):
        p = np.hstack([pts, np.ones((len(pts), 1))]) @ Hg.T
        return (p[:, :2] / p[:, 2:3]).astype(np.float32)
    licht = rng.uniform(0, 2 * np.pi)
    karten = []
    # erst alle Karten legen, dann den Fächer ins Bild schieben (meist mittig)
    lagen = []
    for i, k in enumerate(klassen):
        th = np.radians(th0 + i * spread + rng.normal(0, 1.5))
        verschieb = rng.normal(0, [0.02 * w, 0.03 * h]) + i * schritt
        lok = np.array([[0, 0], [w, 0], [w, h], [0, h]]) - [pu, pv] + verschieb
        R = np.array([[np.cos(th), -np.sin(th)], [np.sin(th), np.cos(th)]])
        lagen.append(lok @ R.T)
    alle = np.vstack(lagen)
    mitte = (alle.min(0) + alle.max(0)) / 2
    P = np.array([S / 2, S / 2]) - mitte + rng.normal(0, 0.12, 2) * S
    for i, k in enumerate(klassen):
        quad = nach_bild(lagen[i] + P)
        t = TEX[rng.choice(PRO_KLASSE[k])]
        a = ALPHA
        if rng.random() < 0.5: t = t[::-1, ::-1]; a = a[::-1, ::-1]
        M = cv2.getPerspectiveTransform(np.float32([[0, 0], [TW, 0], [TW, TH], [0, TH]]), quad)
        warp = cv2.warpPerspective(t, M, (S, S), flags=cv2.INTER_LINEAR)
        am = cv2.warpPerspective(np.ascontiguousarray(a), M, (S, S), flags=cv2.INTER_LINEAR)
        # Schatten auf das Darunterliegende
        if rng.random() < 0.85:
            off = np.array([np.cos(licht), np.sin(licht)]) * rng.uniform(1, 5)
            T = np.float32([[1, 0, off[0]], [0, 1, off[1]]])
            sch = cv2.GaussianBlur(cv2.warpAffine(am, T, (S, S)), (0, 0), rng.uniform(1.5, 4))
            img = (img * (1 - rng.uniform(0.15, 0.45) * sch[..., None])).astype(np.uint8)
        # leichte Aufhellung/Abdunklung je Karte (Wölbung, Licht)
        g = np.linspace(rng.uniform(0.85, 1.05), rng.uniform(0.85, 1.05), S, dtype=np.float32)
        warp = np.clip(warp * (g[None, :, None] if rng.random() < 0.5 else g[:, None, None]), 0, 255)
        img = (img * (1 - am[..., None]) + warp * am[..., None]).astype(np.uint8)
        owner[am > 0.5] = i
        karten.append((k, M))
    # Drehpunkt im Bild (für Daumen)
    P = nach_bild((P)[None])[0]
    # Handfläche hinter den Karten (nur wo keine Karte liegt)
    if rng.random() < 0.8:
        hinten = img.copy(); o2 = owner.copy()
        ellipse(hinten, o2, rng, P + rng.normal(0, 0.3, 2) * w, (w * rng.uniform(0.6, 1.2), w * rng.uniform(0.9, 1.6)), rng.uniform(0, 180), haut(rng))
        frei = owner == -1
        img[frei] = hinten[frei]
    # Daumen über den Karten
    if rng.random() < 0.85:
        c = P + rng.normal(0, 0.45, 2) * w
        ang = rng.uniform(0, 180)
        ax = (w * rng.uniform(0.18, 0.3), w * rng.uniform(0.45, 0.95))
        ellipse(img, owner, rng, c, ax, ang, haut(rng), wert_owner=-2)
        if rng.random() < 0.7:  # Nagel
            vec = np.array([np.cos(np.radians(ang + 90)), np.sin(np.radians(ang + 90))])
            ellipse(img, owner, rng, c + vec * ax[1] * 0.7, (ax[0] * 0.6, ax[1] * 0.25), ang, haut(rng) * 1.15)
    # Ziele
    ziele = []
    for i, (k, M) in enumerate(karten):
        felder = ECKE + (MITTE if ist_bild(k) else [])
        for (x0, y0, x1, y1) in felder:
            poly = np.float32([[x0 * TW, y0 * TH], [x1 * TW, y0 * TH], [x1 * TW, y1 * TH], [x0 * TW, y1 * TH]])
            q = cv2.perspectiveTransform(poly[None], M)[0]
            flaeche = 0.5 * abs(np.dot(q[:, 0], np.roll(q[:, 1], 1)) - np.dot(q[:, 1], np.roll(q[:, 0], 1)))
            if flaeche < 20: continue
            m = np.zeros((S, S), np.uint8)
            cv2.fillConvexPoly(m, q.astype(np.int32), 1)
            sicht = (m > 0) & (owner == i)
            anteil = sicht.sum() / flaeche
            if anteil < 0.2: continue
            ys, xs = np.nonzero(sicht) if sicht.any() else np.nonzero(m)
            if len(xs) == 0: continue
            ziele.append((k, xs.mean(), ys.mean(), np.sqrt(max(sicht.sum(), 1)), 1.0 if anteil >= 0.5 else 0.0))
    # Foto-Effekte
    f = img.astype(np.float32)
    if rng.random() < 0.8:
        gx, gy = np.meshgrid(np.linspace(-1, 1, S), np.linspace(-1, 1, S))
        f *= (1 + rng.uniform(-0.35, 0.35) * gx + rng.uniform(-0.35, 0.35) * gy)[..., None]
    f *= rng.uniform(0.8, 1.2, 3)[None, None, :] * rng.uniform(0.65, 1.25)
    if rng.random() < 0.3:  # Spiegelung
        m = np.zeros((S, S), np.float32)
        cv2.ellipse(m, tuple(int(v) for v in rng.integers(0, S, 2)), (int(rng.integers(10, S // 3)), int(rng.integers(5, S // 6))), rng.uniform(0, 180), 0, 360, 1, -1)
        f += cv2.GaussianBlur(m, (0, 0), rng.uniform(5, 25))[..., None] * rng.uniform(40, 160)
    f = np.clip(f, 0, 255)
    f = 255 * (f / 255) ** rng.uniform(0.75, 1.35)
    img = np.clip(f, 0, 255).astype(np.uint8)
    if rng.random() < 0.3:
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.int16)
        hsv[..., 0] = (hsv[..., 0] + rng.integers(-6, 7)) % 180
        hsv[..., 1] = np.clip(hsv[..., 1] * rng.uniform(0.7, 1.3), 0, 255)
        img = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)
    r = rng.random()
    if r < 0.45: img = cv2.GaussianBlur(img, (0, 0), rng.uniform(0.3, 1.4))
    elif r < 0.6:
        L = int(rng.integers(3, 9)); k = np.zeros((L, L), np.float32); k[L // 2, :] = 1 / L
        k = cv2.warpAffine(k, cv2.getRotationMatrix2D((L / 2 - 0.5, L / 2 - 0.5), rng.uniform(0, 180), 1), (L, L))
        img = cv2.filter2D(img, -1, k / max(k.sum(), 1e-6))
    if rng.random() < 0.25:
        s = rng.uniform(0.45, 0.8)
        img = cv2.resize(cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA), (S, S), interpolation=cv2.INTER_LINEAR)
    if rng.random() < 0.6:
        img = np.clip(img + rng.normal(0, rng.uniform(1, 7), img.shape), 0, 255).astype(np.uint8)
    q = int(rng.integers(35, 96))
    img = cv2.imdecode(cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, q])[1], cv2.IMREAD_COLOR)
    return img, np.array(ziele, np.float32).reshape(-1, 5)

if __name__ == '__main__':
    ziel, n, start = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    S = int(sys.argv[4]) if len(sys.argv) > 4 else 320
    os.makedirs(ziel, exist_ok=True)
    for i in range(start, start + n):
        rng = np.random.default_rng(i * 7919 + 13)
        img, z = szene(rng, S)
        cv2.imwrite(f'{ziel}/{i:06d}.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 93])
        np.save(f'{ziel}/{i:06d}.npy', z)
