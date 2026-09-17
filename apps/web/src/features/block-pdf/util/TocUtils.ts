import type Section from '../model/Section';

class TocUtils {
  public static getSection({
    id,
    idToSectionMap,
  }: {
    id: number;
    idToSectionMap: Partial<Record<number, Section>>;
  }): Section {
    const section = idToSectionMap[id];
    if (!section) {
      throw new Error('Failed to find section with ID ' + id);
    }
    return section.clone();
  }
}

export default TocUtils;
