import re,html,json,time,urllib.request,sys
CATS=["aguas","bebidas-lacteas","bebidas-vegetales","energizantes","gaseosa","hidratantes","jugos-y-refrescos","malta","sodas-y-mezcladores","sueros","te-e-infusiones"]
UA={"User-Agent":"Mozilla/5.0 (DistriPostobon catalogo; contacto andresrivera9426@gmail.com)"}
def get(u):
    return urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=30).read().decode()
out={}
for c in CATS:
    for p in range(1,30):
        s=get(f"https://www.weshop.com.co/categorias/bebidas/{c}?product_list_limit=36&p={p}")
        blocks=re.findall(r'<li class="item product product-item">(.*?)</li>\s*(?=<li class="item product product-item">|</ol>)',s,re.S)
        nuevos=0
        for b in blocks:
            l=re.search(r'class="product-item-link"\s*href="([^"]+)"[^>]*>\s*(.*?)\s*</a>',b,re.S)
            im=re.search(r'class="product-image-photo"[^>]*src="([^"]+)"',b) or re.search(r'src="([^"]+/media/catalog/product/[^"]+)"',b)
            if not l: continue
            url=l.group(1); 
            if url in out: continue
            nuevos+=1
            out[url]={"nombre":html.unescape(re.sub(r'<[^>]+>','',l.group(2))).strip(),"url":url,"imagen":im.group(1) if im else None,"categoria_weshop":c,"agotado":"No disponible" in b}
        print(c,p,len(blocks),nuevos,file=sys.stderr)
        if nuevos==0: break
        time.sleep(1)
json.dump(list(out.values()),open("weshop_bebidas.json","w"),ensure_ascii=False,indent=1)
print(len(out))
