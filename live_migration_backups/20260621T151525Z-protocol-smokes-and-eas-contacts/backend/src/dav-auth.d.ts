import { Request, Response, NextFunction } from 'express';
export declare function davBasicAuth(realm: string): (req: Request, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>>>;
//# sourceMappingURL=dav-auth.d.ts.map