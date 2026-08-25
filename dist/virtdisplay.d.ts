export declare class VirtualDisplay {
    private debug;
    private proc;
    private _display;
    constructor(debug?: boolean);
    private get xvfb_args();
    private get xvfb_path();
    /**
     * Launch Xvfb with -displayfd 3 so the kernel/Xvfb itself picks a free
     * display number atomically and reports it back to us. Avoids userspace race conditions
     */
    private spawnXvfb;
    get(): Promise<string>;
    kill(): void;
    private static assert_linux;
}
