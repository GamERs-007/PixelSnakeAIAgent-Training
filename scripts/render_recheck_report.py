"""Render the editable technical-report Markdown using ReportLab 4.4.9."""
from html import escape
from pathlib import Path
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, Table, TableStyle, PageBreak, Preformatted

ROOT=Path(__file__).resolve().parents[1];NAME='Pixel_Snake_RL_Reevaluation_and_Ultimate_Control_Report'
source=ROOT/'reports'/f'{NAME}.md';target=source.with_suffix('.pdf')
W,H=A4;M=45;WIDTH=W-2*M
styles=getSampleStyleSheet()
styles.add(ParagraphStyle(name='Body',fontName='Helvetica',fontSize=9.2,leading=13.3,spaceAfter=8,textColor=colors.HexColor('#28384a')))
styles.add(ParagraphStyle(name='Top',fontName='Helvetica-Bold',fontSize=19,leading=24,spaceAfter=17,textColor=colors.HexColor('#173751'),keepWithNext=True))
styles.add(ParagraphStyle(name='Sub',fontName='Helvetica-Bold',fontSize=12,leading=16,spaceBefore=9,spaceAfter=8,textColor=colors.HexColor('#147d77'),keepWithNext=True))
styles.add(ParagraphStyle(name='SmallHead',fontName='Helvetica-Bold',fontSize=10.3,leading=14,spaceBefore=8,spaceAfter=6,keepWithNext=True))
styles.add(ParagraphStyle(name='Cell',fontName='Helvetica',fontSize=7.3,leading=10,wordWrap='CJK',textColor=colors.HexColor('#233449')))
styles.add(ParagraphStyle(name='Caption',fontName='Helvetica-Oblique',fontSize=8,leading=11,spaceAfter=10,textColor=colors.HexColor('#526270')))
styles.add(ParagraphStyle(name='CodeBlock',fontName='Courier',fontSize=7.5,leading=10.5,spaceBefore=5,spaceAfter=8,backColor=colors.HexColor('#f1f5f8')))

def inline(text):
    text=text.replace('→',' -> ').replace('−','-').replace('±','+/-').replace('×','x')
    text=escape(text)
    text=re.sub(r'`([^`]+)`',lambda m:'<font name="Courier" size="8">'+m[1]+'</font>',text)
    text=re.sub(r'\*\*([^*]+)\*\*',r'<b>\1</b>',text)
    text=re.sub(r'\[([^\]]+)\]\(([^)]+)\)',r'\1',text)
    return text

def footer(canvas,doc):
    canvas.saveState();canvas.setStrokeColor(colors.HexColor('#d7e1e9'));canvas.line(M,38,W-M,38)
    canvas.setFont('Helvetica',8);canvas.setFillColor(colors.HexColor('#627384'))
    canvas.drawString(M,25,'PIXELSNAKE  /  TECHNICAL RE-EVALUATION')
    canvas.drawRightString(W-M,25,str(doc.page));canvas.restoreState()

def cells(line):return [x.strip() for x in line.strip().strip('|').split('|')]

story=[]
for section_id,section in enumerate(source.read_text(encoding='utf8').split('<!-- pagebreak -->')):
    if section_id:story.append(PageBreak())
    lines=section.strip().splitlines();i=0
    while i<len(lines):
        line=lines[i].strip()
        if not line:i+=1;continue
        if line.startswith('```'):
            code=[];i+=1
            while i<len(lines) and not lines[i].startswith('```'):
                # Code lines are wrapped visually without changing editable source.
                s=lines[i]
                while len(s)>100:code.append(s[:100]);s='  '+s[100:]
                code.append(s);i+=1
            story.append(Preformatted('\n'.join(code),styles['CodeBlock']));i+=1;continue
        if line.startswith('|'):
            rows=[]
            while i<len(lines) and lines[i].strip().startswith('|'):
                row=cells(lines[i]);i+=1
                if all(re.fullmatch(r'[:\- ]+',c) for c in row):continue
                rows.append(row)
            n=len(rows[0])
            if rows[0][0]=='Index':widths=[WIDTH*.09,WIDTH*.34,WIDTH*.57]
            elif n==2:widths=[WIDTH*.40,WIDTH*.60]
            elif n==3:widths=[WIDTH*.42,WIDTH*.29,WIDTH*.29]
            else:widths=[WIDTH/n]*n
            data=[[Paragraph(('<b>'+inline(c)+'</b>') if r==0 else inline(c),styles['Cell']) for c in row] for r,row in enumerate(rows)]
            t=Table(data,colWidths=widths,repeatRows=1,hAlign='LEFT')
            t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e3eef2')),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#f5f8fa')]),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),('LINEBELOW',(0,0),(-1,0),.7,colors.HexColor('#a8becb'))]))
            story.extend([t,Spacer(1,10)]);continue
        img=re.match(r'!\[[^]]*\]\(([^)]+)\)',line)
        if img:
            p=(source.parent/img[1]).resolve();im=Image(str(p));im.drawHeight=WIDTH*im.imageHeight/im.imageWidth;im.drawWidth=WIDTH
            story.extend([im,Spacer(1,5)]);i+=1;continue
        if line.startswith('# '):style='Top';line=line[2:]
        elif line.startswith('## '):style='Sub';line=line[3:]
        elif line.startswith('### '):style='SmallHead';line=line[4:]
        elif line.startswith('*Figure '):style='Caption';line=line.strip('*')
        else:style='Body'
        if line.startswith('- '):line='&#8226; '+inline(line[2:]);formatted=True
        else:formatted=False
        story.append(Paragraph(line if formatted else inline(line),styles[style]));i+=1
doc=SimpleDocTemplate(str(target),pagesize=A4,rightMargin=M,leftMargin=M,topMargin=44,bottomMargin=50,
    title='PixelSnake: Reinforcement Learning Re-evaluation and Ultimate Control',author='PixelSnake project',subject='Frozen-model evaluation and dense-board recovery analysis')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
print(target)
