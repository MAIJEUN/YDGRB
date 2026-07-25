import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * 작은 JSON 파일 저장소.
 *
 * - 읽기는 메모리에 캐시한다 (이 프로세스만 파일을 건드린다고 가정).
 * - 쓰기는 큐로 직렬화해서 동시에 두 번 쓰이지 않게 한다.
 * - 임시 파일에 먼저 쓴 뒤 rename 하므로, 쓰는 도중에 죽어도 파일이 깨지지 않는다.
 */
export class JsonFile<T> {
  readonly #filePath: string;
  readonly #createEmpty: () => T;

  #cache: T | undefined;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(filePath: string, createEmpty: () => T) {
    this.#filePath = filePath;
    this.#createEmpty = createEmpty;
  }

  async read(): Promise<T> {
    if (this.#cache !== undefined) return this.#cache;

    let data: T;
    try {
      data = JSON.parse(await readFile(this.#filePath, "utf8")) as T;
    } catch (error) {
      // 파일이 아직 없을 때만 빈 값으로 시작한다. 깨진 JSON 은 조용히 덮어쓰지 않는다.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      data = this.#createEmpty();
    }

    this.#cache = data;
    return data;
  }

  /**
   * `mutate` 안에서 데이터를 고치면 저장까지 해 준다.
   * 여러 번 호출해도 하나씩 순서대로 실행되므로 읽고-고치고-쓰는 사이에 끼어들 수 없다.
   */
  async update<R>(mutate: (data: T) => R): Promise<R> {
    const task = this.#queue.then(async (): Promise<R> => {
      const data = await this.read();
      const result = mutate(data);
      await this.#flush(data);
      return result;
    });

    // 하나가 실패해도 다음 작업까지 막히지 않게 체인은 이어 둔다.
    this.#queue = task.catch(() => undefined);

    return task;
  }

  async #flush(data: T): Promise<void> {
    await mkdir(path.dirname(this.#filePath), { recursive: true });

    const temporary = `${this.#filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await rename(temporary, this.#filePath);
  }
}
