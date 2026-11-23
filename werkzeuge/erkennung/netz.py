import torch, torch.nn as nn, torch.nn.functional as F, torchvision
class Netz(nn.Module):
    """MobileNetV3-Large (ImageNet) bis Stufe 32, kleines FPN, Heatmap pro Karte auf Stufe 8."""
    def __init__(self, klassen=36, kanal=96, vortrainiert=True):
        super().__init__()
        w = torchvision.models.MobileNet_V3_Large_Weights.IMAGENET1K_V1 if vortrainiert else None
        f = torchvision.models.mobilenet_v3_large(weights=w).features
        self.s8, self.s16, self.s32 = f[:7], f[7:13], f[13:16]
        self.l8, self.l16, self.l32 = nn.Conv2d(40, kanal, 1), nn.Conv2d(112, kanal, 1), nn.Conv2d(160, kanal, 1)
        self.glatt = nn.Sequential(nn.Conv2d(kanal, kanal, 3, padding=1, groups=kanal), nn.Conv2d(kanal, kanal, 1), nn.BatchNorm2d(kanal), nn.ReLU(inplace=True))
        self.kopf = nn.Sequential(nn.Conv2d(kanal, kanal, 3, padding=1), nn.ReLU(inplace=True), nn.Conv2d(kanal, klassen, 1))
        nn.init.constant_(self.kopf[-1].bias, -4.6)
    def forward(self, x):
        a = self.s8(x); b = self.s16(a); c = self.s32(b)
        p = self.l32(c)
        p = F.interpolate(p, size=b.shape[-2:], mode='nearest') + self.l16(b)
        p = F.interpolate(p, size=a.shape[-2:], mode='nearest') + self.l8(a)
        return self.kopf(self.glatt(p))
