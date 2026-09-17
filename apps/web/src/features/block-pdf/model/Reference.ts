interface IReference {
  pageNum: number;
  yPos: number;
  context: string;
}

class Reference implements IReference {
  pageNum: number;
  yPos: number;
  context: string;

  constructor({ pageNum, yPos, context }: IReference) {
    if (typeof pageNum !== 'number' || pageNum < 0) {
      console.error('Invalid reference pageNum');
    } else if (typeof yPos !== 'number' || !yPos) {
      console.error('Invalid reference yPos');
    } else if (!context || typeof context !== 'string') {
      console.error('Invalid reference context');
    }

    this.pageNum = pageNum;
    this.yPos = yPos;
    this.context = context;
  }

  static fromXML(xml: Element): Reference {
    const context = document.createElement('textarea');
    context.innerHTML = xml.textContent || '';

    return new Reference({
      pageNum: parseInt(xml.getAttribute('page') || ''),
      yPos: parseInt(xml.getAttribute('y') || ''),
      context: context.value,
    });
  }
}

export default Reference;
