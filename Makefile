MAIN_TEX ?= main.tex

.PHONY: build watch clean

build:
	latexmk -pdf -interaction=nonstopmode -synctex=1 $(MAIN_TEX)

watch:
	latexmk -pdf -pvc -interaction=nonstopmode -synctex=1 $(MAIN_TEX)

clean:
	latexmk -C
	rm -f *.synctex.gz
