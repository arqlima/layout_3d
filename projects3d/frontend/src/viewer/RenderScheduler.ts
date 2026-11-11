/** Coalesces edits; a draw may request the next frame while controls settle. */
export class RenderScheduler {
  private frame: number | null = null;
  private active = true;
  private disposed = false;

  constructor(private readonly draw: () => void) {}

  invalidate(): void {
    if (!this.active || this.disposed || this.frame !== null) return;
    this.frame = requestAnimationFrame(this.render);
  }

  setActive(active: boolean): void {
    this.active = active;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    if (active) this.invalidate();
  }

  dispose(): void {
    this.disposed = true;
    this.setActive(false);
  }

  private readonly render = (): void => {
    this.frame = null;
    if (this.active && !this.disposed) this.draw();
  };
}
