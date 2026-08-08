import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumberString,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class StartMultipartDto {
  /** What the client says it is about to upload. Verified again on completion. */
  @IsInt()
  @Min(1)
  size!: number;
}

export class UploadPartDto {
  @IsString()
  @Length(1, 4096)
  ticket!: string;

  /** Multipart form fields arrive as text, so this is a numeric string. */
  @IsNumberString()
  partNumber!: string;
}

export class PartDto {
  @IsInt()
  @Min(1)
  @Max(10_000)
  partNumber!: number;

  @IsString()
  @Length(1, 256)
  etag!: string;
}

export class CompleteMultipartDto {
  @IsString()
  @Length(1, 4096)
  ticket!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10_000)
  @ValidateNested({ each: true })
  @Type(() => PartDto)
  parts!: PartDto[];
}

export class AbortMultipartDto {
  @IsString()
  @Length(1, 4096)
  ticket!: string;
}
