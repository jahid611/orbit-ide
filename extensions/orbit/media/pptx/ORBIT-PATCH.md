# Copie modifiée de PptxViewJS 1.1.9 (MIT)

Une ligne changée dans `calculateStandardLineHeight` : l'interligne suit la plus grande police de la ligne (× 1,2) aussi quand elle est PLUS GRANDE que la taille héritée du paragraphe. L'original ne le faisait que pour les polices plus petites : un titre de 32 pt sur plusieurs lignes gardait l'interligne d'un texte de 18 pt et ses lignes se chevauchaient.

    - if(t>0&&t<r)r=1.2*t
    + if(t>0)r=1.2*t

À refaire si la bibliothèque est mise à jour.

Deuxième ligne changée, dans le dessin des lignes de texte : la ligne de base se place d'après l'interligne réel de la ligne (0,8 × interligne) au lieu de la taille de police héritée du paragraphe. Avec l'original, un texte de 11 pt dans un paragraphe hérité de 18 pt descendait trop bas, un titre de 28 pt montait trop haut, et les deux se chevauchaient.

    - const x=y+.8*b
    + const x=y+.8*s
