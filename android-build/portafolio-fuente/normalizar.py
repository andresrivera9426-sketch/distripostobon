import json,re
d=json.load(open('weshop_bebidas.json'))
EXCL_PROMO=re.compile(r'(?i)(^combo|^precio incre|^pack celebraci|pague \d+ lleve| \+ )')
TERCEROS=re.compile(r'(?i)red bull')
MARCAS=[("Postobón Acqua","acqua postob"),("H2Oh!","h2oh"),("Cristalite","cristalite"),("Cristal Aloe","cristal aloe"),("Agua Cristal","agua cristal"),("Hatsu","hatsu"),("Bilac","bilac"),("Speed Max","speed max"),("Gatorlit","gatorlit"),("Gatorade","gatorade"),("Squash","squash"),("Hit","hit "),("Tutti Frutti","tutti"),("Natumalta","natumalta"),("Bretaña","breta"),("Canada Dry","canada dry"),("Maxlit","maxlit"),("Mr. Tea","mr. tea"),("Pepsi","pepsi"),("Seven Up","seven up"),("Colombiana","colombiana"),("Postobón","postob")]
CAT={"aguas":"Aguas","bebidas-lacteas":"Bebidas lácteas","bebidas-vegetales":"Bebidas vegetales","energizantes":"Energizantes","gaseosa":"Gaseosas","hidratantes":"Hidratantes","jugos-y-refrescos":"Jugos y refrescos","malta":"Maltas","sodas-y-mezcladores":"Sodas y mezcladores","sueros":"Sueros","te-e-infusiones":"Té"}
FECHA="2026-11-07"
out=[];excl=[];vistos=set()
for x in d:
    n=re.sub(r'\s+',' ',x['nombre']).strip()
    if EXCL_PROMO.search(n): excl.append((n,"combo/promoción de varios productos")); continue
    if TERCEROS.search(n): excl.append((n,"marca de tercero (no del portafolio propio verificado)")); continue
    nl=n.lower().replace('mlx','ml x').replace('ltx','lt x')
    marca=next((m for m,k in MARCAS if k in nl+" "),"Sin identificar")
    env=next((e for e in ["Pet","Lata","Vidrio","Tetrapak","Bolsa","Garrafa","Friopack","Botellón"] if re.search(r'\b'+e.lower()+r'\b',nl)),"")
    vol=re.search(r'(\d+(?:[.,]\d+)?)\s*(ml|l|lt|ltx)\b',nl.replace('ltx','lt '))
    vol=(vol.group(1).replace(',','.')+(' ml' if vol.group(2)=='ml' else ' L')) if vol else ""
    und=re.search(r'x\s*(\d+)\s*und|x(\d+)\b',nl); und=int(next(g for g in und.groups() if g)) if und else 1
    pres=" ".join(p for p in [env,vol,f"x{und}"] if p)
    k=(n.lower())
    if k in vistos: continue
    vistos.add(k)
    out.append({"nombre":n,"marca":marca,"categoria":CAT[x['categoria_weshop']],"presentacion":pres,"envase":env,"volumen":vol,"unidades":und,
      "agotado_en_fuente":x['agotado'],"fuente":x['url'],"imagen_oficial_url":x['imagen'],"fecha_consulta":FECHA})
json.dump({"fuente":"WeShop by Postobón (tienda oficial en línea) – https://www.weshop.com.co/categorias/bebidas","fecha_consulta":FECHA,
  "nota":"Referencias publicadas en la tienda en línea a la fecha; no es un listado exhaustivo de SKUs mayoristas. Sin precios ni stock. Fotos no incluidas: los T&C de WeShop/Postobón prohíben su reproducción sin autorización escrita.",
  "productos":out,"excluidos":[{"nombre":a,"motivo":b} for a,b in excl]},open('portafolio.json','w'),ensure_ascii=False,indent=1)
from collections import Counter
print(len(out),len(excl)); print(Counter(o['marca'] for o in out)); print(Counter(o['categoria'] for o in out))
print([o['nombre'] for o in out if o['marca']=='Sin identificar' or not o['volumen']])
